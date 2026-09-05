/**
 * Which navigation item is the current page.
 *
 * EXTRACTED, not invented. This is the matcher that already lived inline in
 * components/admin/super-nav.tsx, where it correctly kept "Settlements" lit on
 * /settlements/<id>. It was the only place in the product that did this: the
 * shop, rider and admin PRIMARY navs all rendered every link identically,
 * including the one you were standing on. Lifting it here gives all of them one
 * implementation with tests behind it.
 *
 * LONGEST MATCH WINS, and that is the whole design. It means callers never need
 * an exclusion list: pass the four shop destinations AND /shop/orders/new, and
 * the booking route beats /shop/orders on its own length. Without that, a naive
 * prefix test lights "Parcels" while the shop is booking -- and New Order is
 * deliberately an action, not a destination.
 */

/** A trailing slash is the same page; nothing else about the path is touched. */
function normalise(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

/**
 * The entry in `hrefs` that best matches `pathname`, or null when none does.
 *
 * Matching is exact, or a `/`-delimited prefix. The delimiter matters: without
 * it `/shop/order` would match `/shop/orders`, lighting a nav item for a page
 * in a different section.
 *
 * Returns the caller's OWN string, not the normalised one, because every caller
 * compares it back against the same array with `===` to decide which link to
 * light. Handing back a cleaned-up copy would silently fail that comparison for
 * anyone who wrote an href with a trailing slash.
 */
export function activeHref(pathname: string, hrefs: readonly string[]): string | null {
  const path = normalise(pathname)
  let best: string | null = null
  let bestLength = -1

  for (const raw of hrefs) {
    const href = normalise(raw)
    if (path !== href && !path.startsWith(`${href}/`)) continue
    if (href.length > bestLength) {
      best = raw
      bestLength = href.length
    }
  }

  return best
}
