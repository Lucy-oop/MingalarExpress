'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Coins, History, LayoutList } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/components/shared/i18n-provider'

/**
 * The rider's bottom tabs — and the one screen that takes their place.
 *
 * HIDDEN ON A JOB, deliberately. A rider with a parcel in their hand is
 * mid-task: the thing that must be reachable by thumb is the DONE button, not a
 * link to their earnings. Stacking a sticky action bar above these tabs costs
 * about 120px of a 640px screen — a third of the viewport before any content —
 * so the job screen takes this space instead, and navigation falls back to the
 * back control at the top of that page.
 *
 * THREE TABS NOW, not two. Way history was a small text link in the top-right
 * corner of the earnings page, on the reasoning that "how much" and "what did I
 * do" are the same backward look. That reasoning was sound and the placement
 * was still wrong: the link sat diagonally opposite the thumb on a screen held
 * one-handed, rendered at text-sm beside an h1, and was the only way to reach a
 * whole screen. A destination nothing else links to is primary navigation
 * whatever its subject matter.
 *
 * WHICH TAB IS LIT, which nothing said before. All three rendered in the same
 * muted grey on every route, so the bar showed where a rider could go and never
 * where they were. `aria-current` carries the same fact to a screen reader.
 *
 * A client component only for `usePathname`; the rest of the shell stays server
 * rendered.
 */
export function RiderTabs() {
  const t = useT()
  const pathname = usePathname() ?? ''

  // `/rider/jobs/<id>`. Every other rider screen keeps its tabs.
  if (pathname.startsWith('/rider/jobs/')) return null

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-3">
        <Tab
          href="/rider/dashboard"
          label={t('nav.jobs')}
          icon={<LayoutList className="size-6" />}
          active={pathname.startsWith('/rider/dashboard')}
        />
        <Tab
          href="/rider/ways"
          label={t('nav.history')}
          icon={<History className="size-6" />}
          active={pathname.startsWith('/rider/ways')}
        />
        <Tab
          href="/rider/earnings"
          label={t('nav.earnings')}
          icon={<Coins className="size-6" />}
          active={pathname.startsWith('/rider/earnings')}
        />
      </div>
    </nav>
  )
}

function Tab({
  href,
  label,
  icon,
  active,
}: {
  href: string
  label: string
  icon: React.ReactNode
  active: boolean
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-16 flex-col items-center justify-center gap-1 text-xs active:bg-muted',
        // `text-primary` IS the brand red — globals.css sets --primary to
        // --brand-red (#c62828). Naming the token rather than the hex is what
        // keeps the tab bar in step with every other primary control if the
        // identity is ever re-sheeted.
        active ? 'font-bold text-primary' : 'font-medium text-muted-foreground',
      )}
    >
      {icon}
      {label}
    </Link>
  )
}
