import Link from 'next/link'
import { Coins, LayoutList, LogOut } from 'lucide-react'
import { requireRider } from '@/lib/auth/guards'
import { signOut } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { QueueBanner } from '@/components/rider/queue-banner'
import { GpsBanner } from '@/components/rider/gps-banner'
import { LanguageToggle } from '@/components/shared/language-toggle'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { I18nProvider } from '@/components/shared/i18n-provider'
import { ServiceWorkerRegistrar } from '@/components/shared/service-worker'

/**
 * Mobile-first shell. No sidebar, bottom tab bar, generous tap targets —
 * this is used one-handed, on a bike mount, often in the rain.
 */
export default async function RiderLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireRider()
  const locale = await getLocale()
  const t = translator(locale)

  return (
    // The locale crosses the boundary as a STRING; every client component below
    // reads it through useT(). See components/shared/i18n-provider.
    <I18nProvider locale={locale}>
    {/* `lang` here, not on <html>: globals.css's `:lang(my)` line-height rule
        for stacked Myanmar diacritics had never matched, because the root
        layout hardcodes lang="en". Admin is English-only whatever the cookie
        says, so the attribute belongs on the bilingual shells. */}
    <div lang={locale} className="flex min-h-dvh flex-col bg-muted/30">
      <ServiceWorkerRegistrar />
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{profile.full_name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{t('app.rider')}</p>
          </div>
          {/* Both scripts visible and both tappable: a rider who cannot read the
              current language cannot read a dropdown's closed state either. */}
          <div className="flex shrink-0 items-center gap-1">
            <LanguageToggle locale={locale} />
            <form action={signOut}>
              <Button variant="ghost" size="icon" type="submit" aria-label={t('action.signOut')}>
                <LogOut />
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-3 px-3 pb-24 pt-3">
        {/* In the shell, beside the queue banner, so it is on the job page too.
            The job page used to swallow a denied permission in silence and let
            the rider stamp checkpoints with no coordinates at all. */}
        <GpsBanner />
        <QueueBanner />
        {children}
      </main>

      {/* Bottom tabs, above the iOS home indicator. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-background pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-2">
          <Tab href="/rider/dashboard" label={t('nav.jobs')} icon={<LayoutList className="size-6" />} />
          <Tab href="/rider/earnings" label={t('nav.earnings')} icon={<Coins className="size-6" />} />
        </div>
      </nav>
    </div>
    </I18nProvider>
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
