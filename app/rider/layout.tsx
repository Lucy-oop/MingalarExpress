import Link from 'next/link'
import { Coins, LayoutList, LogOut } from 'lucide-react'
import { requireRider } from '@/lib/auth/guards'
import { signOut } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { QueueBanner } from '@/components/rider/queue-banner'
import { ServiceWorkerRegistrar } from '@/components/shared/service-worker'

/**
 * Mobile-first shell. No sidebar, bottom tab bar, generous tap targets —
 * this is used one-handed, on a bike mount, often in the rain.
 */
export default async function RiderLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireRider()

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <ServiceWorkerRegistrar />
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{profile.full_name}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Mingalar Express rider
            </p>
          </div>
          <form action={signOut}>
            <Button variant="ghost" size="sm" type="submit" aria-label="Sign out">
              <LogOut />
            </Button>
          </form>
        </div>
      </header>

      <main className="flex-1 space-y-3 px-3 pb-24 pt-3">
        <QueueBanner />
        {children}
      </main>

      {/* Bottom tabs, above the iOS home indicator. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-background pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-2">
          <Tab href="/rider/dashboard" label="Jobs" icon={<LayoutList className="size-5" />} />
          <Tab href="/rider/earnings" label="Earnings" icon={<Coins className="size-5" />} />
        </div>
      </nav>
    </div>
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
