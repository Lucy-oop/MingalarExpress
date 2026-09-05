'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { activeHref } from '@/lib/nav/active'

/**
 * Sub-navigation for the Super Admin panel. Client-side only for the active
 * highlight — longest-prefix matching so /settlements/<id> keeps Settlements lit.
 *
 * That matcher used to live inline here and was the only one in the product;
 * it now lives in lib/nav/active.ts with tests, and the shop shell uses it too.
 */
export function SuperNav({ items }: { items: Array<{ href: string; label: string }> }) {
  const pathname = usePathname()
  const active = activeHref(pathname, items.map((i) => i.href))

  return (
    <nav aria-label="Super admin" className="flex gap-1 overflow-x-auto rounded-lg border bg-card p-1">
      {items.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={href === active ? 'page' : undefined}
          className={cn(
            'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            href === active
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
