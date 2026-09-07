import Link from 'next/link'
import { LogOut } from 'lucide-react'
import { requireDispatch, isAdmin } from '@/lib/auth/guards'
import { signOut } from '@/lib/auth/actions'
import { BrandMark } from '@/components/shared/brand-mark'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AdminNav } from '@/components/admin/admin-nav'
import { NoticeBell } from '@/components/admin/notice-bell'
import { getOfficeNotices } from '@/lib/admin/shop-queries'
import { officeNotices } from '@/lib/admin/notices'
import { createClient } from '@/lib/supabase/server'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Dispatchers and Super Admins share this shell; /admin/super is additionally
  // gated by middleware (longest-prefix) and by requireAdmin in its own layout.
  const { profile } = await requireDispatch()
  const admin = isAdmin(profile.role)

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
          <Link href="/admin/dispatcher">
            <BrandMark tagline={false} className="text-left" />
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <NoticeBell notices={notices} seenAt={me?.notices_seen_at ?? null} />
            <Badge tone={admin ? 'gold' : 'blue'}>
              {admin ? 'Super Admin' : 'Dispatcher'}
            </Badge>
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
        <AdminNav admin={admin} />
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-4">{children}</main>
    </div>
  )
}
