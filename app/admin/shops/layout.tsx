import { requireAdmin } from '@/lib/auth/guards'
import { SuperNav } from '@/components/admin/super-nav'
import { SUPER_NAV_ITEMS } from '@/lib/admin/nav'

/**
 * Shop management sits outside the `/admin/super` segment, so it needs its own
 * copy of that segment's two guarantees: the Super Admin gate, and the tab bar.
 * Middleware already restricts `/admin/shops`; this is the render-path net that
 * no matcher gap or rewrite can skip.
 */
export default async function AdminShopsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()

  return (
    <div className="space-y-4">
      <SuperNav items={[...SUPER_NAV_ITEMS]} />
      {children}
    </div>
  )
}
