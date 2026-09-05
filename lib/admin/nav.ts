/**
 * The admin panel's two navigation lists, in one file so they can be checked
 * against each other.
 *
 * THEY USED TO OVERLAP ALMOST ENTIRELY. Five of the sub-nav's seven items —
 * Overview, Riders, Shops, Settlements and COD audit — were the same label
 * pointing at the same href as a top-bar link, so a super admin on
 * /admin/super/riders saw fifteen links for nine destinations with "Riders"
 * twice, one of them aimed at the page they were already on. `nav.test.ts`
 * asserts the two lists never share an href again, which is the only thing that
 * stops this growing back the next time a page is added.
 */

export type NavItem = {
  href: string
  label: string
  /** Icon key; the client component owns the actual lucide component. */
  icon: string
  /** Hidden from dispatchers. */
  adminOnly?: boolean
}

/** The top bar. Every destination in the panel has exactly one home here. */
export const ADMIN_NAV_ITEMS: readonly NavItem[] = [
  { href: '/admin/dispatcher', label: 'Dispatch', icon: 'radio' },
  // Dispatchers too, not admins only: answering "where is this parcel" is the
  // job of whoever picks up the phone.
  { href: '/admin/orders', label: 'Orders', icon: 'package' },
  // Also dispatchers: a KPay transfer sits in neither the rider's hands nor the
  // books until somebody checks it, and leaving that to one person is how a
  // queue builds up for a week.
  { href: '/admin/kpay', label: 'KBZPay', icon: 'smartphone' },
  { href: '/admin/super', label: 'Overview', icon: 'dashboard', adminOnly: true },
  { href: '/admin/super/riders', label: 'Riders', icon: 'bike', adminOnly: true },
  { href: '/admin/shops', label: 'Shops', icon: 'store', adminOnly: true },
  { href: '/admin/super/settlements', label: 'Settlements', icon: 'banknote', adminOnly: true },
  { href: '/admin/audit', label: 'COD audit', icon: 'scale', adminOnly: true },
] as const

/**
 * The Super Admin sub-navigation: only what lives nowhere else.
 *
 * Overview stays although the top bar also has it — it is the section's own
 * index, and without it Coverage and Pricing have no way back except going up
 * to the top bar. Everything else that was here is one click away up there.
 *
 * Rendered ONLY under /admin/super/*. `/admin/shops` used to render it too, and
 * stopped when Shops left the list: a tab bar with nothing lit on the current
 * page is worse than no tab bar. `/admin/audit` never rendered it at all, which
 * is why clicking "COD audit" here used to make the whole bar disappear.
 */
export const SUPER_NAV_ITEMS = [
  { href: '/admin/super', label: 'Overview' },
  { href: '/admin/super/areas', label: 'Coverage' },
  { href: '/admin/super/pricing', label: 'Pricing' },
] as const

/**
 * Hrefs in both lists.
 *
 * Overview is the one sanctioned overlap, for the reason above. Anything else
 * appearing here is the duplication coming back.
 */
export const ALLOWED_NAV_OVERLAP: readonly string[] = ['/admin/super']

/**
 * Sub-nav entries that light only on an EXACT match.
 *
 * `/admin/super` is a prefix of every page in the section, so as an ordinary
 * entry it lights wherever nothing longer is listed -- "Overview" highlighted
 * while the reader is on Riders. That was masked while Riders and Settlements
 * were also in this list, both longer and both winning, and surfaced the moment
 * they were removed.
 */
export const SUPER_NAV_EXACT: readonly string[] = ['/admin/super']
