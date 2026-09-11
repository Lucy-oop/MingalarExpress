import Link from 'next/link'
import { requireShop } from '@/lib/auth/guards'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { BrandMark } from '@/components/shared/brand-mark'
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
import { ShopNoticeBell } from '@/components/shop/shop-notice-bell'
import { getShopNotifications } from '@/lib/orders/queries'
import { createClient } from '@/lib/supabase/server'

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  // Second of three checks (middleware → here → RLS). See lib/auth/guards.ts.
  const { profile } = await requireShop()
  const locale = await getLocale()
  const t = translator(locale)

  /*
    ALL THREE AT ONCE. The policy read used to sit on its own `await` above the
    Promise.all below it, which cost a whole extra sequential round trip -- 175
    to 340ms against this project -- on EVERY shop page, for no reason: nothing
    below depends on its result except the `gated` flag, which is only read at
    render time. /shop/dashboard was the slowest route in the app at ten
    sequential round trips, and this was one of them.

    THE POLICY READ IS STILL PER-REQUEST AND STILL CURRENT. It has to be: the
    terms must stop appearing the moment they are accepted. It also still FAILS
    OPEN -- a read that errors returns `unknown`, which shouldBlock() answers
    false to, which is what stops a missing migration locking every shop out of
    every page at once. See lib/legal/gate.

    THE FEED IS HEADER CHROME, so neither half may break a page: the query
    swallows its own error and returns [], and the marker falls back to null,
    which `isNewSince` reads as "everything is new" rather than throwing.

    A short slice, not the page's 120. `shop-parcel-alert` already refreshes
    every shop page on a realtime event, so this count moves on its own.
  */
  const supabase = await createClient()
  const [acceptance, notices, { data: me }] = await Promise.all([
    readPolicyAcceptance(COD_ADVANCE_POLICY.key),
    getShopNotifications(24),
    supabase.from('profiles').select('notices_seen_at').eq('id', profile.id).maybeSingle(),
  ])
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
        {/*
          IT FITS ON ONE ROW NOW. The contents came to ~440px against the 328px
          a 360px phone gives, so `flex-wrap` dropped the action group onto a
          second line — a ~103px two-row bar on every phone, before any content.

          Both halves shrank rather than one being hidden: the wordmark loses
          "EXPRESS" below `sm` (~65px) and the language toggle uses its short
          labels (~50px), which together more than pay for the icon buttons
          growing from 32px to 44px. `flex-wrap` STAYS as the valve — it is what
          makes the worst case a taller bar instead of a broken one — and
          `min-w-0` on the brand means a future label overruns into a truncated
          wordmark before it reaches that.

          `gap-x-2` below `sm` for the same reason; the roomier `gap-x-4`
          returns where there is room for it.
        */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 sm:gap-x-4">
          <Link
            href="/shop/dashboard"
            aria-label="Mingalar Express — shop home"
            className="min-w-0 shrink"
          >
            <BrandMark tagline={false} size="sm" compact className="truncate text-left" />
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
          {/* `gap-3` between the icons, not `gap-2`: the bell and sign-out are
              two unlabelled 44px targets side by side and one of them ends the
              session. 12px of separation is the cheapest way to make that
              misfire less likely. */}
          <div className="ml-auto flex shrink-0 items-center gap-3 xl:ml-0">
            {gated ? null : (
              <>
                <NewOrderButton className="hidden lg:inline-flex" />
                <span aria-hidden="true" className="hidden h-6 w-px shrink-0 bg-border lg:block" />
              </>
            )}
            {/* Left of the language toggle, matching the office header. Hidden
                while the policy gate is up: nothing behind it is reachable. */}
            {gated ? null : (
              <ShopNoticeBell groups={notices} seenAt={me?.notices_seen_at ?? null} />
            )}
            {/* Both scripts, both tappable — same reasoning as the rider shell. */}
            <LanguageToggle locale={locale} />
            {/* Icon-only on a phone, and 44px rather than the default 40px
                icon size — it is the last thing in a row of small targets. */}
            <SignOutButton label={t('action.signOut')} iconOnly className="size-11" />
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
      {/*
        THE BOTTOM RESERVE HAS TO CLEAR THE FAB, NOT THE TAB BAR.

        This was `pb-28` — 112px, which is the 64px tab bar plus a little. But
        `NewOrderFab` floats ABOVE the tab bar at
        `bottom-[calc(4rem+1rem+env(safe-area-inset-bottom))]` with `h-12`, so
        its top edge is 128px up. The last 16px of every shop page sat under it,
        on the right-hand side where the FAB is.

        Expressed as the same calc the FAB uses rather than a rounder magic
        number, so the two move together: tab bar + gap + FAB + breathing room.
        The inset is included because it now resolves to something — see the
        note on `viewportFit` in app/layout.tsx.
      */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-[calc(4rem+1rem+3rem+1rem+env(safe-area-inset-bottom))] lg:pb-6 print:max-w-none print:p-0">
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
