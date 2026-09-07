'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Coins, LayoutDashboard, PackagePlus, Store, Table2 } from 'lucide-react'
import { activeHref } from '@/lib/nav/active'
import { useT } from '@/components/shared/i18n-provider'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MessageKey } from '@/lib/i18n'

/**
 * The shop shell's navigation, in both of its shapes.
 *
 * CLIENT, and it has to be: the active highlight needs `usePathname`, and a
 * `layout.tsx` is never handed the pathname to pass down. Everything else about
 * this file is the same markup that used to sit in the layout.
 *
 * It reads the language through `useT()` and takes no `locale` and no `t` prop.
 * `dictionary.test.ts` fails the build on a `t` prop -- that guard is what
 * caught the last version of this header -- and `lib/i18n` imports nothing
 * server-only precisely so the hook works on this side of the boundary.
 */

const BOOKING_HREF = '/shop/orders/new'

/**
 * Five destinations. Booking is not among them: it is an action, drawn as the
 * one filled control in the shell.
 */
const NAV: Array<{ href: string; key: MessageKey; icon: typeof LayoutDashboard }> = [
  { href: '/shop/dashboard', key: 'shop.nav.dashboard', icon: LayoutDashboard },
  { href: '/shop/orders', key: 'shop.nav.orders', icon: Table2 },
  { href: '/shop/money', key: 'shop.nav.money', icon: Coins },
  { href: '/shop/settings', key: 'shop.nav.settingsTab', icon: Store },
]

/**
 * BOOKING_HREF is in the list on purpose. `activeHref` takes the longest match,
 * so /shop/orders/new beats /shop/orders and no nav item lights while the shop
 * is booking -- which is what we want, because New Order is highlighted
 * instead. Leaving it out would light "Parcels" on the booking page.
 */
const MATCHABLE = [...NAV.map((n) => n.href), BOOKING_HREF]

function useActive() {
  const pathname = usePathname()
  return activeHref(pathname ?? '', MATCHABLE)
}

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** The header nav: one row of its own until `xl`, inline in the bar after that. */
export function ShopNavLinks({ className }: { className?: string }) {
  const t = useT()
  const active = useActive()

  return (
    <nav aria-label="Shop sections" className={cn('gap-1', className)}>
      {NAV.map(({ href, key, icon: Icon }) => {
        const current = href === active
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              /*
                NO SCROLLBAR, AND NO WRAPPING. A horizontal scrollbar under a
                desktop primary nav hides tabs and reads as broken, so the
                header's `overflow-x-auto` is gone -- which means these five
                have to fit by construction rather than by valve.

                Where the room came from: `px-2.5` and `gap-1` over `px-3` and
                `gap-1.5` returns about 50px across five items, and the short
                Settings label another 40. At the tightest case -- xl, where the
                nav shares the bar rather than having its own row -- that leaves
                the five Burmese labels inside roughly 570px of a 628px slot.

                `whitespace-nowrap` because a label that wraps inside its own
                flex item is the awkward second row by another route, and
                `shrink-0` so a tab is never squeezed narrower than its text.
              */
              'flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors',
              FOCUS,
              // Deliberately NOT SuperNav's `bg-primary` treatment: in this
              // shell that is the New Order button's styling, sitting inches
              // away, and two filled controls would read as two CTAs.
              current
                ? 'bg-muted font-semibold text-foreground'
                : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {t(key)}
          </Link>
        )
      })}
    </nav>
  )
}

/**
 * The phone's bottom tab bar, copied from the rider shell -- same fixed
 * position, same safe-area inset, same 64px targets. Matching it is half the
 * point: the two apps had two different navigation models for no reason.
 */
export function ShopTabs() {
  const t = useT()
  const active = useActive()

  return (
    <nav
      aria-label="Shop sections"
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {/*
        ONE COLUMN PER DESTINATION, and the number has moved twice. It was
        grid-cols-4, then Updates arrived in 01f63ce and put a fifth child in a
        four-column grid: it wrapped, doubling the height of a FIXED bottom bar
        and covering the content on every phone. That was fixed to five, and
        Updates has now moved to a bell in the header — so it is four again.

        The count is pinned by a test in shop-nav.test.ts, which derives BOTH
        this number and NAV.length from source and compares them. A Tailwind
        class cannot be computed from NAV.length without defeating the JIT,
        which is why the test exists rather than an expression.
      */}
      <div className="grid grid-cols-4">
        {NAV.map(({ href, key, icon: Icon }) => {
          const current = href === active
          return (
            <Link
              key={href}
              href={href}
              aria-current={current ? 'page' : undefined}
              className={cn(
                // `break-words` because five across on a 360px screen is 72px
                // a tab, and 'အသိပေးချက်' does not fit on one line there.
                'flex min-h-16 flex-col items-center justify-center gap-1 px-0.5 text-center text-[11px] leading-tight break-words active:bg-muted',
                FOCUS,
                current ? 'font-semibold text-primary' : 'font-medium text-muted-foreground',
              )}
            >
              <Icon className="size-6" />
              {t(key)}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

/**
 * The booking action. Inline in the header from `lg` up; a floating pill above
 * the tab bar on a phone, where the header has no room for it.
 */
export function NewOrderButton({ className }: { className?: string }) {
  const t = useT()
  const active = useActive()

  return (
    <Link
      href={BOOKING_HREF}
      aria-current={active === BOOKING_HREF ? 'page' : undefined}
      className={cn(buttonVariants(), 'shrink-0 gap-1.5', className)}
    >
      <PackagePlus className="size-4" />
      {t('shop.nav.new')}
    </Link>
  )
}

/**
 * Sits above the tab bar, clear of the iOS home indicator. `shadow-lg` because
 * it floats over scrolling content rather than over chrome.
 */
export function NewOrderFab() {
  return (
    <NewOrderButton className="fixed right-4 z-20 h-12 px-5 text-base shadow-lg lg:hidden bottom-[calc(4rem+1rem+env(safe-area-inset-bottom))]" />
  )
}
