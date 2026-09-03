import Link from 'next/link'
import { Coins, LayoutDashboard, LogOut, PackagePlus, Store, Table2 } from 'lucide-react'
import { requireShop } from '@/lib/auth/guards'
import { signOut } from '@/lib/auth/actions'
import { BrandMark } from '@/components/shared/brand-mark'
import { Button } from '@/components/ui/button'
import { LanguageToggle } from '@/components/shared/language-toggle'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import type { MessageKey } from '@/lib/i18n'

const NAV: Array<{ href: string; key: MessageKey; icon: typeof LayoutDashboard }> = [
  { href: '/shop/dashboard', key: 'shop.nav.dashboard', icon: LayoutDashboard },
  // Booking sits third in the bar but first in the day: it is the reason a shop
  // opens this at all, so it is also the only nav item drawn as a button.
  { href: '/shop/orders', key: 'shop.nav.orders', icon: Table2 },
  { href: '/shop/orders/new', key: 'shop.nav.new', icon: PackagePlus },
  { href: '/shop/money', key: 'shop.nav.money', icon: Coins },
  { href: '/shop/settings', key: 'shop.nav.settings', icon: Store },
]

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  // Second of three checks (middleware → here → RLS). See lib/auth/guards.ts.
  const { profile } = await requireShop()
  const locale = await getLocale()
  const t = translator(locale)

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
            {/* Both scripts, both tappable — same reasoning as the rider shell. */}
            <LanguageToggle locale={locale} />
            <form action={signOut}>
              <Button variant="ghost" size="icon" type="submit" aria-label={t('action.signOut')}>
                <LogOut />
              </Button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2">
          {NAV.map(({ href, key, icon: Icon }) => {
            const primary = href === '/shop/orders/new'
            return (
              <Link
                key={href}
                href={href}
                className={
                  primary
                    ? 'flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground'
                    : 'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
                }
              >
                <Icon className="size-4" />
                {t(key)}
              </Link>
            )
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}
