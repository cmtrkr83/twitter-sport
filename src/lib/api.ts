export interface TweetItem {
  id: string
  author: string
  user: string
  text: string
  createdAt: string
  hasLink: boolean
  resolvedUrls: string[]
}

export interface UserTweetGroup {
  user: string
  tweets: TweetItem[]
}

export interface TweetsSnapshot {
  capturedAt: string
  apiStatus: 'live'
  source: string
  windowLabel: string
  limit: number
  users: string[]
  totalTweets: number
  tweets: TweetItem[]
  perUserResults: UserTweetGroup[]
}

export interface SavedUsersResponse {
  users: string[]
}

function normalizeUsers(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((item) => String(item).trim().replace(/^@+/, '').toLowerCase())
            .filter(Boolean),
        ),
      )
    : []
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const responseContentType = response.headers.get('content-type') ?? ''

    if (responseContentType.includes('application/json')) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string; details?: string }
        | null

      const message = body?.details || body?.error
      throw new Error(message || `İstek başarısız oldu (${response.status})`)
    }

    const bodyText = await response.text().catch(() => '')
    throw new Error(bodyText || `İstek başarısız oldu (${response.status})`)
  }

  return (await response.json()) as T
}

export async function fetchTweetsSnapshot(
  signal?: AbortSignal,
  users: string[] = [],
  limit: 6 | 12 | 24 = 6,
): Promise<TweetsSnapshot> {
  const params = new URLSearchParams({
    users: users.join(','),
    limit: String(limit),
  })

  const response = await fetch(`/api/tweets?${params.toString()}`, {
    signal,
    headers: {
      Accept: 'application/json',
    },
  })

  return readJsonResponse<TweetsSnapshot>(response)
}

export async function fetchSavedUsers(signal?: AbortSignal): Promise<string[]> {
  const response = await fetch('/api/users', {
    signal,
    headers: {
      Accept: 'application/json',
    },
  })

  const payload = await readJsonResponse<SavedUsersResponse>(response)
  return normalizeUsers(payload.users)
}

export async function saveSavedUsers(users: string[]): Promise<string[]> {
  const response = await fetch('/api/users', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ users }),
  })

  const payload = await readJsonResponse<SavedUsersResponse>(response)
  return normalizeUsers(payload.users)
}