import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Clock, Phone } from 'lucide-react'
import { BrandMark } from '@/components/shared/brand-mark'
import { ContactChannelList } from '@/components/shared/contact-channels'
import { OFFICE_HOURS, contactChannels } from '@/lib/contact/channels'
import { getPublicSettings } from '@/lib/settings/public'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Contact us' }

/**
 * Public — no auth, and no middleware change needed: `middleware.ts` gates by
 * prefix (`/admin`, `/shop`, `/rider`), so everything else is open by omission.
 *
 * WHY THIS EXISTS. The sign-in footer used to show a bare phone number, which
 * was already an improvement on the nine places that said "contact the office"
 * and gave no way to. But a `tel:` link is the wrong shape for how this
 * business is actually reached in Yangon: Viber is the default messaging app,
 * and Facebook is where a customer already messages a shop.
 *
 * SERVER COMPONENT, so no `I18nProvider` — that exists for client components,
 * and there are none here. `lang={locale}` goes on the wrapper because
 * `app/layout.tsx` hardcodes `<html lang="en">`, and without it the
 * `:lang(my) { line-height: 1.9 }` rule in globals.css never fires and the
 * Burmese diacritics collide.
 */
export default async function ContactPage() {
  const locale = await getLocale()
  const t = translator(locale)
  const { supportPhone } = await getPublicSettings()

  const channels = contactChannels(supportPhone)
  const call = channels.find((c) => c.id === 'phone')
  const help = channels.filter((c) => c.kind === 'support' && c.id !== 'phone')
  const social = channels.filter((c) => c.kind === 'social')

  return (
    <main
      lang={locale}
      className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-10"
    >
      <BrandMark />

      <div className="space-y-1 text-center">
        <h1 className="text-lg font-semibold">{t('contact.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('contact.intro')}</p>
      </div>

      {/* The number first and biggest: everything else on this page is a way of
          not having to ring, but ringing is what people do when it matters. */}
      {call ? (
        <Card>
          <CardContent className="space-y-3 pt-5">
            <a href={call.href} className={buttonVariants({ size: 'touch', block: true })}>
              <Phone />
              {t('contact.call')}
            </a>
            <p className="text-center font-mono text-lg font-semibold">{call.detail}</p>
            {/* Hours sit WITH the number, not in a footer. A number with no
                hours is a promise the office breaks at ten at night. */}
            <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
              {t('contact.hours')} · {OFFICE_HOURS[locale]}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {help.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t('contact.help')}</h2>
          <ContactChannelList channels={help} />
          <p className="text-xs text-muted-foreground">{t('contact.helpHint')}</p>
        </section>
      ) : null}

      {social.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t('contact.follow')}</h2>
          <ContactChannelList channels={social} />
        </section>
      ) : null}

      {/* Everyone who lands here came from the sign-in footer. Without this the
          page is a dead end and the only way back is the browser button. */}
      <Link
        href="/auth/login"
        className={buttonVariants({ variant: 'ghost', block: true, size: 'sm' })}
      >
        <ArrowLeft />
        {t('contact.backToSignIn')}
      </Link>

      <p className="text-center text-xs text-muted-foreground">Serving Greater Yangon</p>
    </main>
  )
}
