import Link from 'next/link'
import { Coins, LayoutDashboard, LogOut, PackagePlus, Store, Table2 } from 'lucide-react'
import { requireShop } from '@/lib/auth/guards'
import { signOut } from '@/lib/auth/actions'
import { BrandMark } from '@/components/shared/brand-mark'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { LanguageToggle } from '@/components/shared/language-toggle'
import { ShopParcelAlert } from '@/components/orders/shop-parcel-alert'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { I18nProvider } from '@/components/shared/i18n-provider'
import type { MessageKey } from '@/lib/i18n'

/**
 * Four destinations. Booking is NOT among them: it is an action, not a place,
 * and it is rendered as a button to the right of these instead. It used to be
 * both -- a fifth nav item AND a hardcoded button in the dashboard header, two
 * CTAs with different wording for the same page.
 */
const NAV: Array<{ href: string; key: MessageKey; icon: typeof LayoutDashboard }> = [
  { href: '/shop/dashboard', key: 'shop.nav.dashboard', icon: LayoutDashboard },
  { href: '/shop/orders', key: 'shop.nav.orders', icon: Table2 },
  { href: '/shop/money', key: 'shop.nav.money', icon: Coins },
  { href: '/shop/settings', key: 'shop.nav.settings', icon: Store },
]

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  // Second of three checks (middleware → here → RLS). See lib/auth/guards.ts.
  const { profile } = await requireShop()
  const locale = await getLocale()
  const t = translator(locale)

  return (
    // The locale crosses the boundary as a STRING; every client component below
    // reads it through useT(). See components/shared/i18n-provider.
    <I18nProvider locale={locale}>
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background print:hidden">
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
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-2 pb-2">
          <nav className="flex gap-1 overflow-x-auto">
            {NAV.map(({ href, key, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Icon className="size-4" />
                {t(key)}
              </Link>
            ))}
          </nav>
          {/*
            A SIBLING of the scrolling list, not a member of it. `ml-auto` on a
            child of an overflow-x-auto row does not right-align it -- it pushes
            it past the edge, off a narrow phone entirely. Outside the scroll
            container it is always on screen, and with four links left the row
            no longer needs to scroll anyway.
          */}
          <Link
            href="/shop/orders/new"
            className={cn(buttonVariants({ size: 'sm' }), 'ml-auto shrink-0')}
          >
            <PackagePlus className="size-4" />
            {t('shop.nav.new')}
          </Link>
        </div>
      </header>
      {/* In the layout, not on individual pages: a shop should hear that a rider
          has taken a parcel while they are on the booking form adding the next
          one. It also carries the debounced refresh that ShopLiveRefresh used to
          do, so there is one socket rather than one per page. */}
      <div className="px-4 pt-4 print:hidden">
        <ShopParcelAlert userId={profile.id} />
      </div>

      <main className="mx-auto max-w-6xl px-4 py-6 print:max-w-none print:p-0">{children}</main>
    </div>
    </I18nProvider>
  )
}
