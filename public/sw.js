/*
 * Mingalar Express rider service worker.
 *
 * Deliberately minimal. A clever caching strategy on a dispatch app is a bug
 * factory: serving a stale jobs feed is worse than showing nothing, because a
 * rider would ride to a pickup that was reassigned ten minutes ago.
 *
 * So:
 *   - Navigations and API calls: NETWORK ONLY, with an offline page as the
 *     fallback. Never a cached HTML response.
 *   - Static build assets: cache-first, since they are content-hashed and
 *     immutable.
 *
 * The queued-actions durability that actually matters lives in IndexedDB
 * (lib/rider/offline-queue.ts), not here. This file exists to make the app
 * installable and to fail gracefully with no signal.
 */

/*
  BUMP THIS WHEN THE PRECACHE LIST CHANGES. `activate` deletes every cache whose
  key does not start with VERSION, so a bump is what evicts a shell holding the
  old icon. It also matters that `cache.addAll` is all-or-nothing: leaving a
  deleted URL in the list below fails the whole install and the app silently
  stops being installable.

  v2: the hand-drawn icon.svg was replaced by the brand logo as PNGs.
*/
const VERSION = 'mge-v2'
const SHELL_CACHE = `${VERSION}-shell`
const ASSET_CACHE = `${VERSION}-assets`
const OFFLINE_URL = '/offline'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll([OFFLINE_URL, '/icon-192.png'])),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never cache anything that reflects live state.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
      ),
    )
    return
  }

  // Immutable build output only.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icon-')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              void caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
  }
})
