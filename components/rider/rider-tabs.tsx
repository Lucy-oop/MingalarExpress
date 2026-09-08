'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Coins, LayoutList } from 'lucide-react'
import { useT } from '@/components/shared/i18n-provider'

/**
 * The rider's bottom tabs — and the one screen that takes their place.
 *
 * HIDDEN ON A JOB, deliberately. A rider with a parcel in their hand is
 * mid-task: the thing that must be reachable by thumb is "DONE — DELIVERED",
 * not a link to their earnings. That primary action used to sit at the very
 * BOTTOM of the job page, below a 192px map, so the most important control on
 * the screen was the last thing on it.
 *
 * Stacking a sticky action bar above these tabs was the alternative and it
 * costs about 120px of a 640px screen — a third of the viewport gone before any
 * content, on a page that can also show the GPS banner. So the job screen takes
 * this space instead, and navigation falls back to the back link already at the
 * top of that page.
 *
 * A client component only for `usePathname`; the rest of the shell stays server
 * rendered.
 */
export function RiderTabs() {
  const t = useT()
  const pathname = usePathname() ?? ''

  // `/rider/jobs/<id>`. The dashboard and earnings keep their tabs.
  if (pathname.startsWith('/rider/jobs/')) return null

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-2">
        <Tab
          href="/rider/dashboard"
          label={t('nav.jobs')}
          icon={<LayoutList className="size-6" />}
        />
        <Tab href="/rider/earnings" label={t('nav.earnings')} icon={<Coins className="size-6" />} />
      </div>
    </nav>
  )
}

function Tab({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground active:bg-muted"
    >
      {icon}
      {label}
    </Link>
  )
}
