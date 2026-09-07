import Link from 'next/link'
import { LogOut } from 'lucide-react'
import { requireShop } from '@/lib/auth/guards'
import { signOut } from '@/lib/auth/actions'
import { BrandMark } from '@/components/shared/brand-mark'
import { Button } from '@/components/ui/button'
import { LanguageToggle } from '@/components/shared/language-toggle'
import { ShopParcelAlert } from '@/components/orders/shop-parcel-alert'
import { PolicyGate } from '@/components/legal/policy-gate'
import { readPolicyAcceptance } from '@/lib/legal/queries'
import { COD_ADVANCE_POLICY } from '@/lib/legal/cod-advance'
import { shouldBlock } from '@/lib/legal/gate'
import { NewOrderButton, NewOrderFab, ShopNavLinks, ShopTabs } from '@/components/shop/shop-nav'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { I18nProvider } from '@/components/shared/i18n-provider'

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  // Second of three checks (middleware → here → RLS). See lib/auth/guards.ts.
  const { profile } = await requireShop()
  const locale = await getLocale()
  const t = translator(locale)

  /*
    One indexed lookup per shop page. It has to be current -- the terms must
    stop appearing the moment they are accepted -- and it FAILS OPEN: a read
    that errors returns `unknown`, which shouldBlock() answers false to. That is
    what stops a missing migration or a dropped connection locking every shop
    out of every page at once. See lib/legal/gate.
  */
  const acceptance = await readPolicyAcceptance(COD_ADVANCE_POLICY.key)
  const gated = shouldBlock(acceptance, COD_ADVANCE_POLICY.version)

  return (
    // The locale crosses the boundary as a STRING; every client component below
    // reads it through useT(). See components/shared/i18n-provider.
    <I18nProvider locale={locale}>
    {/*
      `lang` on the SHELL, not on <html> in the root layout. globals.css carries
      `:lang(my) { line-height: 1.9 }` for stacked Myanmar diacritics, and it had
      never once matched -- the root layout hardcodes lang="en" and nothing
      updated it. Putting the cookie's locale on <html> instead would mislabel
      the admin panel, which is deliberately English-only whatever the cookie
      says. Scoping it to the two bilingual shells is both smaller and truer.
    */}
    <div lang={locale} className="flex min-h-dvh flex-col bg-muted/30">
      {/*
        THREE LAYOUTS, TWO NAV MOUNTS.

          < lg   header = brand + utility; nav = bottom tabs; booking = pill
          lg-xl  header = brand + utility, nav on a second row
          >= xl  one row

        The single row used to switch on at `lg`, which is precisely the width
        where it does not fit: everything in it was `shrink-0` with no wrap and
        no scroll, so a Burmese bar overflowed by ~157px and pushed SIGN-OUT
        off the screen entirely -- the only way to log out, unreachable, plus a
        horizontal scrollbar on every page. Hence `xl`, the owner's name gone
        (117px, and the row cannot fit inside max-w-6xl with it), and `min-w-0
        overflow-x-auto` on the nav as a valve so the worst case is a scrolling
        nav rather than a broken document.

        bg-background/80, not /95: at 95% the backdrop-blur is invisible but
        still costs a compositing layer on every scroll frame, on exactly the
        low-end Android the CSS wordmark exists to spare.
      */}
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
          <Link
            href="/shop/dashboard"
            aria-label="Mingalar Express — shop home"
            className="shrink-0"
          >
            <BrandMark tagline={false} size="sm" className="text-left" />
          </Link>

          {/* One mount for both desktop bands: `order-last w-full` gives it a
              line of its own until xl, where it joins the bar. A third copy in
              the DOM would be the alternative. */}
          {/*
            THE NAV ABSORBS THE SLACK, and this is the fix for the Burmese
            header. It used to be `xl:w-auto` beside an `ml-auto` action group:
            at xl all three sat on one flex line, the nav took only its content
            width, and `ml-auto` shoved the actions to the far right — so the
            leftover space appeared as a gap between them, whose size was
            whatever the translated labels did not use. Five Burmese labels
            plus `:lang(my) { line-height: 1.9 }` also pushed the row past the
            container, and `flex-wrap` then dropped the action group onto a
            second line where `ml-auto` right-aligned it against nothing.

            `xl:flex-1` with `min-w-0` makes the nav take the slack instead, so
            there is nothing left for `ml-auto` to distribute and nothing to
            wrap.

            AND NO OVERFLOW VALVE. This carried `overflow-x-auto` as a hedge,
            which turned the Burmese case into a scrollbar under a desktop
            primary nav -- hiding tabs and looking broken. The five tabs now fit
            by construction instead: tighter padding, a one-word Settings label,
            and nowrap. See the note on the links in shop-nav.tsx.
          */}
          {gated ? null : (
            <ShopNavLinks className="order-last hidden min-w-0 w-full lg:flex xl:order-none xl:flex-1" />
          )}

          {/* `ml-auto` only matters while the nav is on its own line — below xl
              it is what holds the actions to the right of the brand. At xl the
              nav is flex-1 and doing that job, so ml-auto becomes the thing
              opening the gap. */}
          <div className="ml-auto flex shrink-0 items-center gap-2 xl:ml-0">
            {gated ? null : (
              <>
                <NewOrderButton className="hidden lg:inline-flex" />
                <span aria-hidden="true" className="hidden h-6 w-px shrink-0 bg-border lg:block" />
              </>
            )}
            {/* Both scripts, both tappable — same reasoning as the rider shell. */}
            <LanguageToggle locale={locale} />
            <form action={signOut}>
              <Button variant="ghost" size="sm" type="submit" aria-label={t('action.signOut')}>
                <LogOut />
                {/* Named where there is room. An icon alone, immediately beside
                    the language toggle, makes "switch language" and "end my
                    session" neighbours in the same thumb zone. */}
                <span className="hidden sm:inline">{t('action.signOut')}</span>
              </Button>
            </form>
          </div>
        </div>
      </header>

      {/*
        The alert lives INSIDE main, as the rider shell's QueueBanner does.
        It used to sit in a wrapper div of its own, which rendered `pt-4`
        unconditionally even though the component returns null whenever there is
        no news -- a permanent dead band under the header on every page -- and
        which was full-bleed while main is centred, so the two misaligned on any
        wide screen. Moving it fixes both at once.
      */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 lg:pb-6 print:max-w-none print:p-0">
        <ShopParcelAlert userId={profile.id} />
        {children}
      </main>

      {/* The gate is z-50 and these are z-20, so they are already covered --
          this is about not rendering controls nobody can use, and about not
          leaving the panel one z-index edit away from a tappable New Order
          button floating over the terms. */}
      {gated ? null : (
        <>
          <ShopTabs />
          <NewOrderFab />
        </>
      )}

      {gated ? <PolicyGate doc={COD_ADVANCE_POLICY} /> : null}
    </div>
    </I18nProvider>
  )
}
