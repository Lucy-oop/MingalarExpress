import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    /*
      THE CLIENT ROUTER CACHE, which was off.

      `dynamic` defaults to 0 seconds, and every protected route in this app is
      `force-dynamic` — so going back to a tab you left a moment ago refetched
      the whole thing. Flipping between Runs and Orders paid the full server
      render each way.

      15 SECONDS, NOT THE 30 THE DOCS SUGGEST, and the difference is the point.
      This is a dispatch app: `public/sw.js` opens with "a clever caching
      strategy on a dispatch app is a bug factory: serving a stale jobs feed is
      worse than showing nothing, because a rider would ride to a pickup that
      was reassigned ten minutes ago." A client cache is exactly that hazard in
      a smaller window, so the window is small enough that nobody plans off it.

      What makes 15s safe rather than merely short: every operational surface
      busts this cache on its own. The run board and the rider feed hold
      realtime subscriptions that call `router.refresh()` within ~400ms of any
      change (`components/routes/route-board.tsx`,
      `components/rider/rider-dashboard.tsx`), and every server action ends in
      `revalidatePath`. The cache covers idle navigation, which is what was
      slow, and yields immediately to anything that actually moved.

      `static` stays generous: the public tracking page and the login form have
      nothing to go stale.
    */
    staleTimes: { dynamic: 15, static: 300 },
  },
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
      // /shop has no page of its own; the dashboard is the shop's home.
      { source: '/shop', destination: '/shop/dashboard', permanent: false },
      { source: '/merchant', destination: '/shop/dashboard', permanent: false },
      { source: '/merchant/:path*', destination: '/shop/:path*', permanent: false },
      // The daily route manifest is Phase 3 of the route plan and does not exist
      // yet; until it does, a rider lands on their job list.
      { source: '/rider/today-way', destination: '/rider/dashboard', permanent: false },
      { source: '/admin/dispatch-board', destination: '/admin', permanent: false },
      // The board moved to /admin when the dispatcher role was retired and
      // /admin finally got an index page. Kept because this path is in the
      // office's browser history and was the brand mark's target for months.
      { source: '/admin/dispatcher', destination: '/admin', permanent: false },
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
