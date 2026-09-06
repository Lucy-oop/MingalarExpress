import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Clock, Phone } from 'lucide-react'
import { BrandMark } from '@/components/shared/brand-mark'
import { ContactChannelList } from '@/components/shared/contact-channels'
import { OFFICE_HOURS, contactChannels } from '@/lib/contact/channels'
import { getPublicSettings } from '@/lib/settings/public'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import type { MessageKey } from '@/lib/i18n/dictionary'
import { ROLE_HOME, optionalUser } from '@/lib/auth/guards'
import type { UserRole } from '@/types/domain'
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
/**
 * Where the way out points, and what it is called.
 *
 * A shop owner gets the specific label because they are who actually arrives
 * here signed in — the help card on their settings page is the way in. A rider
 * or an admin would be told "Back to my shop", which is simply false, so they
 * get the neutral one.
 */
function backLink(role: UserRole | null): { href: string; label: MessageKey } {
  if (!role) return { href: '/auth/login', label: 'contact.backToSignIn' }
  if (role === 'shop_owner') return { href: ROLE_HOME[role], label: 'contact.backToShop' }
  return { href: ROLE_HOME[role], label: 'contact.back' }
}

export default async function ContactPage() {
  const locale = await getLocale()
  const t = translator(locale)
  const [{ supportPhone }, viewer] = await Promise.all([getPublicSettings(), optionalUser()])
  const back = backLink(viewer?.profile.role ?? null)

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

      {/* Without this the page is a dead end and the only way out is the
          browser's back button.

          IT HAS TO KNOW WHO IS READING IT. This started as a fixed "Back to
          sign in", written when the sign-in footer was the only way in. The
          help card on /shop/settings broke that assumption: a signed-in owner
          following it was offered a lone button that reads like a way to log
          themselves out. `optionalUser` never redirects, so a public page can
          ask. */}
      <Link href={back.href} className={buttonVariants({ variant: 'ghost', block: true, size: 'sm' })}>
        <ArrowLeft />
        {t(back.label)}
      </Link>

      <p className="text-center text-xs text-muted-foreground">Serving Greater Yangon</p>
    </main>
  )
}
