import { requireAdmin } from '@/lib/auth/guards'

/**
 * Shop management sits outside the `/admin/super` segment, so it needs its own
 * copy of that segment's Super Admin gate. Middleware already restricts
 * `/admin/shops`; this is the render-path net that no matcher gap or rewrite
 * can skip.
 *
 * IT NO LONGER RENDERS THE SUPER TAB BAR. Shops left `SUPER_NAV_ITEMS` when the
 * duplication was cleared -- it is a top-bar destination now -- and a tab bar
 * with nothing lit on the page you are standing on is worse than no tab bar.
 * The sub-nav therefore appears only under `/admin/super/*`, where every item in
 * it is genuinely a member.
 */
export default async function AdminShopsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()

  return <div className="space-y-4">{children}</div>
}
