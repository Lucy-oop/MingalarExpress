'use client'

import { useEffect } from 'react'

/**
 * Registers the service worker. Rendered from the rider layout only — shops and
 * dispatchers get no benefit from it and an unnecessary SW is an unnecessary
 * cache-invalidation problem.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Non-fatal: the app works without it, just not installable/offline.
      })
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }, [])

  return null
}
