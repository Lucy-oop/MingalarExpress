import Link from 'next/link'
import { Banknote, Bike, LayoutDashboard, LogOut, Radio, Scale, Store } from 'lucide-react'
import { requireDispatch, isAdmin } from '@/lib/auth/guards'
import { signOut } from '@/lib/auth/actions'
import { BrandMark } from '@/components/shared/brand-mark'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Dispatchers and Super Admins share this shell; /admin/super is additionally
  // gated by middleware (longest-prefix) and by requireAdmin in its own layout.
  const { profile } = await requireDispatch()
  const admin = isAdmin(profile.role)

  // /admin/super carries its own sub-navigation, so this bar only needs the
  // entry points: the board every dispatcher lives on, and the Super Admin
  // areas.
  const nav = [
    { href: '/admin/dispatcher', label: 'Dispatch', icon: Radio, show: true },
    { href: '/admin/super', label: 'Overview', icon: LayoutDashboard, show: admin },
    { href: '/admin/super/riders', label: 'Riders', icon: Bike, show: admin },
    { href: '/admin/shops', label: 'Shops', icon: Store, show: admin },
    { href: '/admin/super/settlements', label: 'Settlements', icon: Banknote, show: admin },
    { href: '/admin/audit', label: 'COD audit', icon: Scale, show: admin },
  ].filter((n) => n.show)

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
        <nav className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-2 pb-2">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-4">{children}</main>
    </div>
  )
}
