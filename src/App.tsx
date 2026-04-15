import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  fetchSavedUsers,
  fetchTweetsSnapshot,
  saveSavedUsers,
  type TweetsSnapshot,
} from './lib/api'
import './App.css'

const REFRESH_INTERVAL_MS = 45_000
const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+|t\.co\/[^\s]+)/gi

function formatRelativeTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'şimdi'
  }

  const deltaMinutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60_000))

  if (deltaMinutes < 60) {
    return `${deltaMinutes} dk önce`
  }

  const deltaHours = Math.round(deltaMinutes / 60)

  if (deltaHours < 24) {
    return `${deltaHours} sa önce`
  }

  const deltaDays = Math.round(deltaHours / 24)
  return `${deltaDays} gün önce`
}

function splitUsernames(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim().replace(/^@+/, '').toLowerCase())
    .filter(Boolean)
}

function normalizeLinkToken(rawToken: string): { href: string; text: string; trailing: string } {
  let text = rawToken
  let trailing = ''

  while (/[.,!?;:)\]]$/.test(text)) {
    trailing = text.slice(-1) + trailing
    text = text.slice(0, -1)
  }

  const href = /^https?:\/\//i.test(text) ? text : `https://${text}`
  return { href, text, trailing }
}

function renderResolvedUrls(urls: string[]): ReactNode[] {
  return urls.flatMap((url, index) => [
    <a
      key={url}
      className="resolved-url-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {url}
    </a>,
    index < urls.length - 1 ? <span key={`${url}-separator`}>•</span> : null,
  ])
}

function renderTweetText(value: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0

  for (const match of value.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    const token = match[0]

    if (start > cursor) {
      nodes.push(value.slice(cursor, start))
    }

    const normalized = normalizeLinkToken(token)

    nodes.push(
      <a
        key={`${normalized.href}-${start}`}
        className="tweet-link"
        href={normalized.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {normalized.text}
      </a>,
    )

    if (normalized.trailing) {
      nodes.push(normalized.trailing)
    }

    cursor = start + token.length
  }

  if (cursor < value.length) {
    nodes.push(value.slice(cursor))
  }

  return nodes.length > 0 ? nodes : [value]
}

function App() {
  const [snapshot, setSnapshot] = useState<TweetsSnapshot | null>(null)
  const [activeUsers, setActiveUsers] = useState<string[]>([])
  const [savedUsers, setSavedUsers] = useState<string[]>([])
  const [newUserInput, setNewUserInput] = useState('')
  const [limit, setLimit] = useState<6 | 12 | 24>(6)
  const [isAutoRefreshEnabled, setIsAutoRefreshEnabled] = useState(false)
  const [tweetTextFilter, setTweetTextFilter] = useState('')
  const [, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasLoadedSavedUsers, setHasLoadedSavedUsers] = useState(false)
  const [currentUserIndex, setCurrentUserIndex] = useState(0)

  const persistUsers = useCallback(async (nextUsers: string[]) => {
    const normalizedUsers = await saveSavedUsers(nextUsers)
    setSavedUsers(normalizedUsers)
    setActiveUsers(normalizedUsers)
    return normalizedUsers
  }, [])

  const loadSnapshot = useCallback(
    async (signal?: AbortSignal, users = activeUsers, nextLimit = limit) => {
      if (users.length === 0) {
        setSnapshot(null)
        setError(null)
        setIsLoading(false)
        return
      }

      setIsLoading(true)

      try {
        const nextSnapshot = await fetchTweetsSnapshot(signal, users, nextLimit)
        setSnapshot(nextSnapshot)
        setError(null)
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : 'Tweetler alınamadı.'
        setError(message)
      } finally {
        setIsLoading(false)
      }
    },
    [activeUsers, limit],
  )

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      try {
        const persistedUsers = await fetchSavedUsers(controller.signal)

        if (controller.signal.aborted) {
          return
        }

        setSavedUsers(persistedUsers)
        setActiveUsers(persistedUsers)
      } catch (caughtError) {
        if (!controller.signal.aborted) {
          const message = caughtError instanceof Error ? caughtError.message : 'Kayıtlı kullanıcılar alınamadı.'
          setError(message)
        }
      } finally {
        if (!controller.signal.aborted) {
          setHasLoadedSavedUsers(true)
        }
      }
    })()

    return () => {
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (!hasLoadedSavedUsers) {
      return
    }

    const controller = new AbortController()
    void loadSnapshot(controller.signal)

    const intervalId = window.setInterval(() => {
      if (isAutoRefreshEnabled) {
        void loadSnapshot(controller.signal)
      }
    }, REFRESH_INTERVAL_MS)

    return () => {
      controller.abort()
      window.clearInterval(intervalId)
    }
  }, [hasLoadedSavedUsers, isAutoRefreshEnabled, loadSnapshot])

  async function saveUser() {
    const [nextUser] = splitUsernames(newUserInput)

    if (!nextUser) {
      return
    }

    const nextSavedUsers = Array.from(new Set([...savedUsers, nextUser]))

    try {
      await persistUsers(nextSavedUsers)
      setNewUserInput('')
      setError(null)
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Kullanıcı kaydedilemedi.'
      setError(message)
    }
  }

  function applyUsers() {
    const nextUsers = savedUsers
    setActiveUsers(nextUsers)

    if (nextUsers.length > 0) {
      void loadSnapshot(undefined, nextUsers, limit)
    }
  }

  async function removeUser(userToRemove: string) {
    const nextSavedUsers = savedUsers.filter((user) => user !== userToRemove)

    try {
      await persistUsers(nextSavedUsers)
      void loadSnapshot(undefined, nextSavedUsers, limit)
      setError(null)
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Kullanıcı silinemedi.'
      setError(message)
    }
  }

  function showPreviousUser() {
    setCurrentUserIndex((currentValue) => Math.max(0, currentValue - 1))
  }

  function showNextUser() {
    setCurrentUserIndex((currentValue) => {
      const lastIndex = Math.max(0, (snapshot?.perUserResults.length ?? 1) - 1)
      return Math.min(lastIndex, currentValue + 1)
    })
  }

  const userPanels = snapshot?.perUserResults ?? []
  const hasUserPanels = userPanels.length > 0
  const currentUserPanel = userPanels[currentUserIndex] ?? null
  const currentUserTweets = currentUserPanel
    ? [...currentUserPanel.tweets].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      )
    : []
  const normalizedTweetTextFilter = tweetTextFilter.trim().toLowerCase()
  const filteredCurrentUserTweets = currentUserTweets.filter((post) => {
    if (!normalizedTweetTextFilter) {
      return true
    }

    return post.text.toLowerCase().includes(normalizedTweetTextFilter)
  })

  useEffect(() => {
    if (currentUserIndex >= userPanels.length) {
      setCurrentUserIndex(0)
    }
  }, [currentUserIndex, userPanels.length])

  return (
    <main className="app-shell">
      <section className="top-control-card">
        <header className="workspace-toolbar">
          <div className="filter-row">
            <label className="search-field user-field">
              <span>Yeni kullanıcı</span>
              <input
                value={newUserInput}
                onChange={(event) => setNewUserInput(event.target.value)}
                placeholder="ornekhesap"
              />
            </label>

            <div className="search-field count-field">
              <span>Tweet Sayısı</span>
              <div className="count-picker" role="group" aria-label="Tweet adedi">
                {[6, 12, 24].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`count-option${limit === value ? ' active' : ''}`}
                    onClick={() => {
                      const nextLimit = value as 6 | 12 | 24
                      setLimit(nextLimit)
                      void loadSnapshot(undefined, activeUsers, nextLimit)
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <button className="secondary-button control-action" type="button" onClick={saveUser}>
              Kaydet
            </button>

            <button className="primary-button control-action" type="button" onClick={applyUsers}>
              Tweetleri getir
            </button>

            <button
              type="button"
              className={`switch-control control-action${isAutoRefreshEnabled ? ' active' : ''}`}
              role="switch"
              aria-checked={isAutoRefreshEnabled}
              onClick={() => setIsAutoRefreshEnabled((currentValue) => !currentValue)}
            >
              <span className="switch-slider" aria-hidden="true" />
              <span className="switch-label-text">
                {isAutoRefreshEnabled ? 'Otomatik yenileme açık' : 'Otomatik yenileme kapalı'}
              </span>
            </button>
          </div>

          <div className="saved-user-panel">
            <div className="saved-user-list" aria-label="Kaydedilmiş kullanıcılar">
              {savedUsers.map((user) => (
                <div className="saved-user-chip" key={user}>
                  <span>@{user}</span>
                  <button
                    className="saved-user-remove"
                    type="button"
                    onClick={() => {
                      void removeUser(user)
                    }}
                    aria-label={`${user} kullanıcısını sil`}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </div>
        </header>
      </section>

      <section className="text-filter-card" aria-label="Ek metin filtresi">
        <div className="text-filter-header">
          <p className="section-label">Ek filtre</p>
          <span className="status-chip">Link + metin</span>
        </div>

        <label className="inline-filter-field" htmlFor="tweet-text-filter">
          <span>Tweet içinde geçen ifade (OPSİYONEL)</span>
          <input
            id="tweet-text-filter"
            value={tweetTextFilter}
            onChange={(event) => setTweetTextFilter(event.target.value)}
            placeholder="ornek: transfer"
          />
        </label>
      </section>

      <section className="workspace">
        {error ? (
          <div className="notice error">
            <strong>Kaynak hatası</strong>
            <p>{error}</p>
          </div>
        ) : null}

        <section className="tweet-feed">
          <div className="section-heading">
            <div>
              <p className="section-label">Sonuçlar</p>
              <h2>Link içeren son tweetler</h2>
            </div>

            <div className="carousel-controls">
              <span className="status-chip">{snapshot?.tweets.length ?? 0} kayıt</span>
              <span className="status-chip">
                {hasUserPanels ? `${currentUserIndex + 1}/${userPanels.length}` : '0/0'}
              </span>
              <div className="carousel-nav-group" aria-label="Kullanıcı gezinmesi">
                <button
                  type="button"
                  className="carousel-nav"
                  onClick={showPreviousUser}
                  disabled={!hasUserPanels || currentUserIndex <= 0}
                  aria-label="Önceki kullanıcıya geç"
                >
                  ←
                </button>
                <button
                  type="button"
                  className="carousel-nav"
                  onClick={showNextUser}
                  disabled={!hasUserPanels || currentUserIndex >= userPanels.length - 1}
                  aria-label="Sonraki kullanıcıya geç"
                >
                  →
                </button>
              </div>
            </div>
          </div>

          <div className="tweet-carousel-shell">
            <div className="tweet-carousel">
              {currentUserPanel ? (
                <section className="user-block carousel-panel" key={currentUserPanel.user}>
                  <header className="user-block-header">
                    <h3>@{currentUserPanel.user}</h3>
                    <span className="status-chip">
                      {filteredCurrentUserTweets.length}/{currentUserPanel.tweets.length} tweet
                    </span>
                  </header>

                  <div className="tweet-rail">
                    {filteredCurrentUserTweets.length > 0 ? (
                      filteredCurrentUserTweets.map((post) => {
                        return (
                          <article className="recent-card tweet-card" key={post.id}>
                            <div className="sample-post-topline">
                              <strong>{post.author}</strong>
                              <span>{formatRelativeTime(post.createdAt)}</span>
                            </div>
                            <p>{renderTweetText(post.text)}</p>
                            {post.resolvedUrls.length > 0 ? (
                              <div className="resolved-url-block resolved-url-block--links">
                                <div className="resolved-url-list">{renderResolvedUrls(post.resolvedUrls)}</div>
                              </div>
                            ) : (
                              <div className="resolved-url-block resolved-url-block--fallback">
                                <span className="resolved-url-fallback">Çözülemedi</span>
                              </div>
                            )}
                          </article>
                        )
                      })
                    ) : (
                      <div className="notice empty-carousel-card">
                        <strong>Eşleşme bulunamadı</strong>
                        <p>
                          {normalizedTweetTextFilter
                            ? 'Bu kullanıcı için link içeren tweetlerde aranan kelime bulunamadı.'
                            : 'Bu kullanıcı için seçilen tweet sayısında link içeren kayıt yok.'}
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
