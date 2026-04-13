import 'dotenv/config'
import http from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { URL } from 'node:url'

import { Rettiwt } from 'rettiwt-api'

const PORT = Number(process.env.PORT ?? 8787)
const API_KEY = process.env.API_KEY?.trim()
const ALLOWED_LIMITS = new Set([6, 12, 24])
const CACHE_TTL_MS = 60_000
const STALE_CACHE_MAX_AGE_MS = 15 * 60_000
const RATE_LIMIT_COOLDOWN_MS = 90_000
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SAVED_USERS_FILE_PATH =
  process.env.SAVED_USERS_FILE_PATH?.trim() || path.join(__dirname, 'saved-users.json')

const snapshotCache = new Map()
let rateLimitUntil = 0

function textValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeUsername(value) {
  return textValue(value).replace(/^@+/, '').trim().toLowerCase()
}

function jsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

function parseUsers(rawValue) {
  return textValue(rawValue)
    .split(/[\n,]/)
    .map((item) => normalizeUsername(item))
    .filter(Boolean)
}

function uniqueUsers(users) {
  return Array.from(new Set(users.map((user) => normalizeUsername(user)).filter(Boolean)))
}

async function readSavedUsersFromDisk() {
  try {
    const rawValue = await readFile(SAVED_USERS_FILE_PATH, 'utf8')
    const parsed = JSON.parse(rawValue)
    return Array.isArray(parsed) ? uniqueUsers(parsed) : []
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

async function writeSavedUsersToDisk(users) {
  const nextUsers = uniqueUsers(users)
  await writeFile(SAVED_USERS_FILE_PATH, `${JSON.stringify(nextUsers, null, 2)}\n`, 'utf8')
  return nextUsers
}

async function readRequestJson(request) {
  const chunks = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const bodyText = Buffer.concat(chunks).toString('utf8').trim()

  if (!bodyText) {
    return null
  }

  return JSON.parse(bodyText)
}

function resolveLimit(rawValue) {
  const numeric = Number(rawValue)

  if (!Number.isFinite(numeric) || !ALLOWED_LIMITS.has(numeric)) {
    return 6
  }

  return numeric
}

function resolveApiKey(requestUrl, requestHeaders) {
  const headerKey = textValue(requestHeaders['x-rettiwt-api-key'])
  const queryKey = textValue(requestUrl.searchParams.get('apiKey'))

  return headerKey || queryKey || API_KEY
}

function createRettiwtClient(apiKey) {
  return apiKey ? new Rettiwt({ apiKey }) : new Rettiwt()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildCacheKey(users, limit) {
  return `${users.join(',')}|${limit}`
}

function getCachedSnapshot(cacheKey, maxAgeMs) {
  const entry = snapshotCache.get(cacheKey)

  if (!entry) {
    return null
  }

  const age = Date.now() - entry.timestamp

  if (age > maxAgeMs) {
    return null
  }

  return entry.payload
}

function saveCachedSnapshot(cacheKey, payload) {
  snapshotCache.set(cacheKey, {
    timestamp: Date.now(),
    payload,
  })
}

function isRateLimitError(error) {
  const message = textValue(error instanceof Error ? error.message : String(error)).toUpperCase()
  return message.includes('TOO_MANY_REQUESTS') || message.includes('429')
}

function extractText(node) {
  return (
    textValue(node?.text) ||
    textValue(node?.fullText) ||
    textValue(node?.full_text) ||
    textValue(node?.content) ||
    textValue(node?.legacy?.full_text) ||
    textValue(node?.legacy?.text) ||
    textValue(node?.raw?.full_text) ||
    textValue(node?.raw?.text)
  )
}

function extractAuthor(node, fallbackUser) {
  const directAuthor = textValue(node?.author)
  if (directAuthor) {
    return directAuthor.startsWith('@') ? directAuthor : `@${directAuthor}`
  }

  const userName =
    textValue(node?.userName) ||
    textValue(node?.legacy?.screen_name) ||
    textValue(node?.core?.user_results?.result?.legacy?.screen_name) ||
    textValue(node?.user_results?.result?.legacy?.screen_name)

  if (userName) {
    return userName.startsWith('@') ? userName : `@${userName}`
  }

  return fallbackUser.startsWith('@') ? fallbackUser : `@${fallbackUser}`
}

function extractCreatedAt(node) {
  return (
    textValue(node?.createdAt) ||
    textValue(node?.created_at) ||
    textValue(node?.legacy?.created_at) ||
    textValue(node?.raw?.created_at) ||
    new Date().toISOString()
  )
}

function extractId(node, fallbackText) {
  return (
    textValue(node?.id) ||
    textValue(node?.rest_id) ||
    textValue(node?.tweetId) ||
    textValue(node?.tweet_id) ||
    textValue(node?.legacy?.id_str) ||
    fallbackText.slice(0, 48)
  )
}

function extractUserId(userDetails) {
  return (
    textValue(userDetails?.id) ||
    textValue(userDetails?.userId) ||
    textValue(userDetails?.rest_id) ||
    textValue(userDetails?.raw?.rest_id) ||
    textValue(userDetails?.raw?.id_str)
  )
}

function hasLink(text) {
  return /https?:\/\/|t\.co\//i.test(text)
}

function mapTweet(node, fallbackUser) {
  const text = extractText(node)

  if (!text || !hasLink(text)) {
    return null
  }

  return {
    id: extractId(node, text),
    author: extractAuthor(node, fallbackUser),
    user: fallbackUser,
    text,
    createdAt: extractCreatedAt(node),
    hasLink: true,
  }
}

async function fetchRecentTweetsForUser(userName, limit, apiKey) {
  const rettiwt = createRettiwtClient(apiKey)
  const userDetails = await rettiwt.user.details(userName)
  const userId = extractUserId(userDetails)

  if (!userId) {
    throw new Error(`Kullanıcı kimliği çözülemedi: ${userName}`)
  }

  const timeline = await rettiwt.user.timeline(userId, limit)
  const list = Array.isArray(timeline?.list) ? timeline.list : []

  return list
    .map((item) => mapTweet(item, userName))
    .filter(Boolean)
    .slice(0, limit)
}

async function fetchTweetsForUsers(users, limit, apiKey) {
  const perUserResults = []

  for (const user of users) {
    const tweets = await fetchRecentTweetsForUser(user, limit, apiKey)
    perUserResults.push({ user, tweets })

    if (users.length > 1) {
      await sleep(350)
    }
  }

  return perUserResults
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,x-rettiwt-api-key',
    })
    response.end()
    return
  }

  if (requestUrl.pathname === '/api/users') {
    if (request.method === 'GET') {
      const users = await readSavedUsersFromDisk()
      jsonResponse(response, 200, { users })
      return
    }

    if (request.method === 'PUT') {
      try {
        const body = await readRequestJson(request)
        const users = Array.isArray(body?.users) ? body.users : []
        const savedUsers = await writeSavedUsersToDisk(users)

        jsonResponse(response, 200, { users: savedUsers })
      } catch (error) {
        jsonResponse(response, 400, {
          error: 'Kullanıcılar kaydedilemedi',
          details: error instanceof Error ? error.message : 'Geçersiz istek gövdesi',
        })
      }

      return
    }

    jsonResponse(response, 405, { error: 'Method Not Allowed' })
    return
  }

  if (requestUrl.pathname === '/api/health') {
    jsonResponse(response, 200, {
      ok: true,
      source: resolveApiKey(requestUrl, request.headers) ? 'user-auth' : 'guest-auth',
      port: PORT,
    })
    return
  }

  if (requestUrl.pathname !== '/api/tweets') {
    jsonResponse(response, 404, { error: 'Not Found' })
    return
  }

  const users = parseUsers(requestUrl.searchParams.get('users'))
  const limit = resolveLimit(requestUrl.searchParams.get('limit') ?? '5')
  const apiKey = resolveApiKey(requestUrl, request.headers)
  const cacheKey = buildCacheKey(users, limit)

  if (users.length === 0) {
    jsonResponse(response, 400, {
      error: 'En az bir kullanıcı adı gerekli.',
    })
    return
  }

  if (Date.now() < rateLimitUntil) {
    const cachedPayload = getCachedSnapshot(cacheKey, STALE_CACHE_MAX_AGE_MS)

    if (cachedPayload) {
      jsonResponse(response, 200, {
        ...cachedPayload,
        source: `${cachedPayload.source} (cache fallback)`,
      })
      return
    }

    jsonResponse(response, 429, {
      error: 'Tweetler çekilemedi',
      details: 'Rettiwt hız limitine ulaşıldı. 60-90 saniye bekleyip tekrar deneyin.',
    })
    return
  }

  const freshCachedPayload = getCachedSnapshot(cacheKey, CACHE_TTL_MS)
  if (freshCachedPayload) {
    jsonResponse(response, 200, {
      ...freshCachedPayload,
      source: `${freshCachedPayload.source} (cache)`,
    })
    return
  }

  try {
    const perUserResults = await fetchTweetsForUsers(users, limit, apiKey)

    const tweets = perUserResults.flatMap((entry) => entry.tweets)

    const payload = {
      capturedAt: new Date().toISOString(),
      apiStatus: 'live',
      source: apiKey ? 'Rettiwt-API user timeline' : 'Rettiwt-API guest timeline',
      windowLabel: 'Son tweetler ve link filtreleri',
      limit,
      users,
      totalTweets: tweets.length,
      tweets,
      perUserResults,
    }

    saveCachedSnapshot(cacheKey, payload)

    jsonResponse(response, 200, payload)
  } catch (error) {
    const limited = isRateLimitError(error)

    if (limited) {
      rateLimitUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS

      const cachedPayload = getCachedSnapshot(cacheKey, STALE_CACHE_MAX_AGE_MS)
      if (cachedPayload) {
        jsonResponse(response, 200, {
          ...cachedPayload,
          source: `${cachedPayload.source} (cache fallback)`,
        })
        return
      }
    }

    jsonResponse(response, limited ? 429 : 502, {
      error: 'Tweetler çekilemedi',
      details: limited
        ? 'Rettiwt hız limitine ulaşıldı. 60-90 saniye bekleyip tekrar deneyin.'
        : error instanceof Error
          ? error.message
          : 'API erişilemedi',
    })
  }
})

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.warn(`Port ${PORT} zaten kullanımda. Mevcut API sunucusu kullanılacak.`)
    process.exit(0)
    return
  }

  console.error('API sunucusu başlatılamadı:', error)
  process.exit(1)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Tweet API ready on http://127.0.0.1:${PORT}`)
})