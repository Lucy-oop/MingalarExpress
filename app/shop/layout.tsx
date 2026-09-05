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
import type { Locale, MessageKey } from '@/lib/i18n'

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
      {/*
        ONE BAR on desktop, two on a phone.

        It used to be two everywhere, and read as two unrelated strips: the
        rows did not even share a gutter (px-4 above, px-2 below), so the nav
        sat eight pixels left of the wordmark, and the right-hand side was three
        unrelated controls in a bare flex row. The wordmark was 30px type, which
        is branding on a login screen and merely tall in a toolbar -- see
        BrandMark's `sm`.

        NavLinks and NewOrderButton are defined once below and mounted twice,
        with `hidden` choosing which. The alternative -- one mount point with
        flex-wrap and per-breakpoint `order` -- expresses each layout as an
        emergent property of five interacting classes rather than as markup you
        can read, and getting `ml-auto` wrong inside a scrolling row is exactly
        the bug this header had a version ago.
      */}
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur print:hidden">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex items-center gap-4 py-2.5">
            <Link href="/shop/dashboard" className="shrink-0">
              <BrandMark tagline={false} size="sm" className="text-left" />
            </Link>

            <NavLinks locale={locale} className="hidden lg:flex" />

            {/* One cluster, in decreasing order of how often it is pressed, with
                rules between the groups so it reads as three things and not
                seven. */}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <NewOrderButton locale={locale} className="hidden lg:inline-flex" />
              <Rule className="hidden lg:block" />
              {/* Both scripts, both tappable — same reasoning as the rider shell. */}
              <LanguageToggle locale={locale} />
              <Rule />
              <span className="hidden max-w-[14ch] truncate text-sm text-muted-foreground sm:inline">
                {profile.full_name}
              </span>
              <form action={signOut}>
                <Button variant="ghost" size="icon" type="submit" aria-label={t('action.signOut')}>
                  <LogOut />
                </Button>
              </form>
            </div>
          </div>

          {/* The phone's second row: the same nav and the same action, sharing
              the gutter above rather than sitting eight pixels off it. */}
          <div className="flex items-center gap-2 pb-2 lg:hidden">
            <NavLinks locale={locale} className="flex min-w-0 flex-1 overflow-x-auto" />
            <NewOrderButton locale={locale} />
          </div>
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

/*
  These take a LOCALE, not a `t`. Both are server components in a server file,
  so handing them the function would work -- and dictionary.test.ts forbids it
  anyway, deliberately. The invariant is worth more than the one line it costs
  here: "no component anywhere declares a `t` prop" is checkable by grep, where
  "no component declares one unless you have reasoned about which side of the
  RSC boundary it lives on" is the situation that produced the original
  serialization crash. Pass the string; build the translator where it is used.
*/

/** A hairline between groups in the utility cluster. */
function Rule({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('h-6 w-px shrink-0 bg-border', className)} />
}

function NavLinks({ locale, className }: { locale: Locale; className?: string }) {
  const t = translator(locale)
  return (
    <nav className={cn('gap-1', className)}>
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
  )
}

/**
 * The one action in the shell, drawn as the one filled control in it. It sits
 * with the other actions on the right rather than at the far end of the nav
 * row, where it had nothing beside it and read as stranded.
 */
function NewOrderButton({ locale, className }: { locale: Locale; className?: string }) {
  const t = translator(locale)
  return (
    <Link
      href="/shop/orders/new"
      className={cn(buttonVariants(), 'shrink-0 gap-1.5', className)}
    >
      <PackagePlus className="size-4" />
      {t('shop.nav.new')}
    </Link>
  )
}
