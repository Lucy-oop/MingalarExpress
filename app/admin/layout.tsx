import Link from 'next/link'
import { LogOut } from 'lucide-react'
import { requireDispatch } from '@/lib/auth/guards'
import { signOut } from '@/lib/auth/actions'
import { BrandMark } from '@/components/shared/brand-mark'
import { Button } from '@/components/ui/button'
import { AdminNav } from '@/components/admin/admin-nav'
import { AdminNoticeBell } from '@/components/admin/notice-bell'
import { getOfficeNotices } from '@/lib/admin/shop-queries'
import { officeNotices } from '@/lib/admin/notices'
import { createClient } from '@/lib/supabase/server'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  /*
    ONE OFFICE ROLE. This shell used to be shared by dispatchers and Super
    Admins, which is why it read the role at all: to filter the nav and to
    label a badge. Both are gone with the dispatcher role, so the guard is the
    only thing left that cares.

    `requireDispatch` is `super_admin` now (see lib/auth/guards.ts for why the
    name survives), and middleware gates all of /admin to the same role, so
    /admin/super's own requireAdmin is a third layer rather than a wider one.
  */
  const { profile } = await requireDispatch()

  /*
    THE FEED IS LAYOUT CHROME, so it must not be able to break a page. Both
    halves fail soft: `getOfficeNotices` swallows its own query error and
    returns [], and the marker read below falls back to null, which the count
    treats as "everything is new" rather than throwing.

    Fetched in the layout on purpose. A merchant can register and be trading in
    the same minute; the office should learn about it wherever they happen to
    be, not only on the one page that shows a worklist.
  */
  const supabase = await createClient()
  const [registrations, { data: me }] = await Promise.all([
    getOfficeNotices(),
    supabase.from('profiles').select('notices_seen_at').eq('id', profile.id).maybeSingle(),
  ])
  const notices = officeNotices(registrations)


  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3">
          <Link href="/admin">
            <BrandMark tagline={false} className="text-left" />
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <AdminNoticeBell notices={notices} seenAt={me?.notices_seen_at ?? null} />
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {profile.full_name}
            </span>
            <form action={signOut}>
              <Button variant="ghost" size="sm" type="submit">
                <LogOut />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </form>
          </div>
        </div>
        <AdminNav />
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-4">{children}</main>
    </div>
  )
}
