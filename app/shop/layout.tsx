import Link from 'next/link'
import { LayoutDashboard, LogOut, PackagePlus, Store, Table2 } from 'lucide-react'
import { requireShop } from '@/lib/auth/guards'
import { signOut } from '@/lib/auth/actions'
import { BrandMark } from '@/components/shared/brand-mark'
import { Button } from '@/components/ui/button'

const NAV = [
  { href: '/shop/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/shop/orders', label: 'Orders', icon: Table2 },
  { href: '/shop/orders/new', label: 'New order', icon: PackagePlus },
  { href: '/shop/settings', label: 'Shop settings', icon: Store },
]

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  // Second of three checks (middleware → here → RLS). See lib/auth/guards.ts.
  const { profile } = await requireShop()

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/shop/dashboard">
            <BrandMark tagline={false} className="text-left" />
          </Link>
          <div className="flex items-center gap-3">
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
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2">
          {NAV.map(({ href, label, icon: Icon }) => (
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
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}
