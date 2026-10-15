// Service worker: keeps the site and compiler working offline after a visit.
// The build (vite.config.ts) prepends `const BASE = ...` and `const FILES = [...]`, the paths of
// every file in this deploy.
//
// - Files under assets/ and pch/ have content hashes in their names and never change: served
//   from the cache, fetched and stored on first use. (Nothing is downloaded up front, so a first
//   visit doesn't fetch the 28 MB compiler twice.)
// - Everything else (the page itself) comes from the network when online, else from the cache.
// - On each new deploy, cached files that are no longer part of the site are deleted.

const CACHE = 'cp-site'
const CURRENT = new Set(FILES)
const IMMUTABLE = [`${BASE}assets/`, `${BASE}pch/bits-`]

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      for (const request of await cache.keys()) {
        if (!CURRENT.has(new URL(request.url).pathname)) await cache.delete(request)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return
  if (IMMUTABLE.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(cacheFirst(event))
  } else {
    event.respondWith(networkFirst(event))
  }
})

// The response goes to the page right away while a copy is stored in the background, so big
// files still stream (and show download progress) on first use.
async function cacheFirst(event) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(event.request)
  if (cached) return cached
  const response = await fetch(event.request)
  if (response.ok) event.waitUntil(cache.put(event.request, response.clone()))
  return response
}

async function networkFirst(event) {
  const request = event.request
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) event.waitUntil(cache.put(request, response.clone()))
    return response
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true })
    if (cached) return cached
    throw error
  }
}
