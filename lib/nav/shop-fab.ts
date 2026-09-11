/**
 * Where the shop's floating New Order button belongs.
 *
 * A PURE FUNCTION, SEPARATE FROM THE COMPONENT, for the reason `activeHref`
 * next door is: this repo has no DOM harness, so a rule left inside a client
 * component can only ever be checked by scanning its source — and a source scan
 * proves the code is written, never that it decides correctly. Here it can be
 * asked directly, with every real route as input.
 */

/**
 * The overview screens: the places a shop is LOOKING at something and may next
 * want to book. Everywhere else it is already booking, reading one parcel, or
 * in settings.
 *
 * AN ALLOWLIST, NOT AN EXCLUSION LIST, and that is the whole design. A denylist
 * means every page added to this shell gets a FAB by default and somebody has
 * to remember to take it away — a failure that is silent and shows up as a
 * button floating over a form. Opting in is one line per screen and cannot be
 * forgotten in the damaging direction.
 *
 * `/shop/orders` is the route the nav labels "Parcels"; there is no
 * `/shop/parcels`.
 */
export const FAB_ROUTES: readonly string[] = [
  '/shop/dashboard',
  '/shop/orders',
  '/shop/money',
]

/**
 * Whether the FAB shows on `pathname`.
 *
 * MATCHED EXACTLY, unlike `activeHref` next door, which matches prefixes.
 * `/shop/orders/new` starts with `/shop/orders`, so a prefix test would leave
 * the button on the booking form — which is the case this exists to remove.
 */
export function showsNewOrderFab(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  // Next does not emit trailing slashes, but normalising is cheaper than the
  // bug if that ever changes.
  const route = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
  return FAB_ROUTES.includes(route)
}
