import { requireAdmin } from '@/lib/auth/guards'
import { SuperNav } from '@/components/admin/super-nav'
import { SUPER_NAV_EXACT, SUPER_NAV_ITEMS } from '@/lib/admin/nav'

/**
 * Third gate on the Super Admin panel.
 *
 * Middleware matches '/admin/super' by longest prefix and the parent
 * /admin layout already required dispatch. This narrows to super_admin in the
 * render path, where no matcher gap or rewrite can skip it. RLS is still the
 * boundary that matters — every write below fails without is_admin() regardless.
 */
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()

  return (
    <div className="space-y-4">
      <SuperNav items={[...SUPER_NAV_ITEMS]} exact={SUPER_NAV_EXACT} />
      {children}
    </div>
  )
}
