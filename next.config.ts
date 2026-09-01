import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Leaflet ships CommonJS and touches `window` at import time; every consumer
  // must be dynamically imported with `ssr: false` (see components/map/MapCanvas).
  serverExternalPackages: ['leaflet'],
  /**
   * Portal URL aliases.
   *
   * The business asked for /login, /register-shop, /merchant/*, /rider/today-way
   * and /admin/dispatch-board. These are redirects onto the routes that already
   * exist rather than a physical move: renaming the tree would touch middleware
   * ROUTE_ROLES, ROLE_HOME, every internal <Link>, every revalidatePath() call
   * and the RLS test matrix — a change worth making deliberately and on its own.
   *
   * `permanent: false` (307) on purpose. A 308 is cached hard by browsers, and
   * these mappings are provisional: when the tree is renamed for real, the
   * arrows reverse.
   *
   * Redirects run BEFORE middleware, so the role gate in middleware.ts sees the
   * final path and needs no new prefixes to stay closed.
   */
  async redirects() {
    return [
      { source: '/login', destination: '/auth/login', permanent: false },
      { source: '/register-shop', destination: '/auth/register', permanent: false },
      { source: '/merchant', destination: '/shop/dashboard', permanent: false },
      { source: '/merchant/:path*', destination: '/shop/:path*', permanent: false },
      // The daily route manifest is Phase 3 of the route plan and does not exist
      // yet; until it does, a rider lands on their job list.
      { source: '/rider/today-way', destination: '/rider/dashboard', permanent: false },
      { source: '/admin/dispatch-board', destination: '/admin/dispatcher', permanent: false },
    ]
  },
  async headers() {
    return [
      {
        // The rider PWA is installed to a phone home screen; never let a stale
        // service worker or manifest pin an old build.
        source: '/:path(manifest.webmanifest|sw.js)',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ]
  },
}

export default nextConfig
