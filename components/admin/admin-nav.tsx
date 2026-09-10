'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Banknote,
  Bike,
  LayoutDashboard,
  Package,
  Radio,
  Scale,
  Smartphone,
  Store,
} from 'lucide-react'
import { ADMIN_NAV_EXACT, ADMIN_NAV_ITEMS } from '@/lib/admin/nav'
import { activeHref } from '@/lib/nav/active'
import { cn } from '@/lib/utils'

/**
 * The admin panel's top bar.
 *
 * CLIENT, for one reason: the active highlight needs `usePathname`, and a
 * `layout.tsx` is never handed one. Icons cannot cross the RSC boundary either,
 * so the lucide components are mapped from the plain `icon` key here rather
 * than travelling in the data — the same shape as components/shop/shop-nav.
 *
 * NO `admin` PROP ANY MORE. It existed to filter `adminOnly` items out for a
 * dispatcher; with one office role every item is shown to everyone who can open
 * this shell at all, and the filter would always have been a no-op.
 *
 * WHY THE HIGHLIGHT MATTERS HERE especially. The sub-nav has always set
 * `aria-current` and a filled background while this bar rendered every link
 * identically, current page included. When the two bars still shared five
 * destinations, that meant the duplicate that looked dead was the one up here —
 * which is most of why the panel read as confusing rather than merely dense.
 */

const ICONS: Record<string, typeof Radio> = {
  radio: Radio,
  package: Package,
  smartphone: Smartphone,
  dashboard: LayoutDashboard,
  bike: Bike,
  store: Store,
  banknote: Banknote,
  scale: Scale,
}

export function AdminNav() {
  const pathname = usePathname()
  const items = ADMIN_NAV_ITEMS
  // Longest match, so /admin/super/riders lights Riders and not Overview.
  // `/admin` is exact-only (ADMIN_NAV_EXACT): it prefixes every other item, so
  // as an ordinary entry it would light "Runs" on any /admin page lacking a nav
  // item of its own.
  const active = activeHref(
    pathname ?? '',
    items.map((i) => i.href),
    { exact: ADMIN_NAV_EXACT },
  )

  return (
    <nav
      aria-label="Admin sections"
      className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-2 pb-2"
    >
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon] ?? Radio
        const current = href === active
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              current
                ? 'bg-muted font-semibold text-foreground'
                : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
