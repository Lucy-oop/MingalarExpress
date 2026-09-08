import { LogOut } from 'lucide-react'
import { requireRider } from '@/lib/auth/guards'
import { signOut } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { QueueBanner } from '@/components/rider/queue-banner'
import { RiderTabs } from '@/components/rider/rider-tabs'
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
        {/*
          NO GPS BANNER. A full-width destructive alert sat here on every rider
          screen, dashboard and job page, whenever the permission was not
          granted -- so a rider who had not yet been asked met a red block
          above their work before they had done anything wrong.

          THERE WERE TWO of these, which is how one survived the first pass:
          this banner, and an amber line inside OnlineToggle printing the
          beacon's `geoError`. Both are gone. What remains is the sub-label on
          the toggle itself -- "GPS on - ±12 m" with a fix, "Waiting for
          GPS..." without one -- which says the same thing at a glance and is
          inside the control the message is ABOUT: being visible to dispatch.

          WHAT THIS GIVES UP, stated plainly because it is a real cost. No
          rider screen now says the permission is blocked. `advance_order`
          still stamps whatever coordinate it gets onto `order_status_events`,
          and with location blocked that is null, silently -- so if a COD
          dispute ever turns on "where was the rider", the answer for those
          checkpoints is nothing, discovered weeks later. A rider stuck on
          "Waiting for GPS..." all shift is the only remaining tell, and it
          does not name the cause. If that bites, the fix is a quiet line on
          the job screen, not a banner on every screen.
        */}
        <QueueBanner />
        {children}
      </main>

      {/* Bottom tabs — absent on a job screen, where the primary action takes
          this space. See components/rider/rider-tabs. */}
      <RiderTabs />
    </div>
    </I18nProvider>
  )
}
