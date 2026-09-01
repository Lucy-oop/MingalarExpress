/**
 * Super Admin sub-navigation.
 *
 * Shared so `/admin/shops` — which sits outside the `/admin/super` segment and
 * therefore does not inherit its layout — still renders the same tab bar. One
 * list, so a new page cannot appear in one place and not the other.
 */
export const SUPER_NAV_ITEMS = [
  { href: '/admin/super', label: 'Overview' },
  { href: '/admin/super/riders', label: 'Riders' },
  { href: '/admin/shops', label: 'Shops' },
  { href: '/admin/super/areas', label: 'Coverage' },
  { href: '/admin/super/pricing', label: 'Pricing' },
  { href: '/admin/super/settlements', label: 'Settlements' },
  { href: '/admin/audit', label: 'COD audit' },
] as const
