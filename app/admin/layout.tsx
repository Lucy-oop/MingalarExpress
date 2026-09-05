import Link from 'next/link'
import { LogOut } from 'lucide-react'
import { requireDispatch, isAdmin } from '@/lib/auth/guards'
import { signOut } from '@/lib/auth/actions'
import { BrandMark } from '@/components/shared/brand-mark'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AdminNav } from '@/components/admin/admin-nav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Dispatchers and Super Admins share this shell; /admin/super is additionally
  // gated by middleware (longest-prefix) and by requireAdmin in its own layout.
  const { profile } = await requireDispatch()
  const admin = isAdmin(profile.role)


  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3">
          <Link href="/admin/dispatcher">
            <BrandMark tagline={false} className="text-left" />
          </Link>
          <div className="flex items-center gap-3">
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
