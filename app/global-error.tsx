'use client'

/**
 * The last resort: the root layout itself failed.
 *
 * ---------------------------------------------------------------------------
 * EVERY CONSTRAINT HERE IS NEXT'S, NOT A STYLE CHOICE. Its docs are explicit:
 *
 *   * this file REPLACES the root layout, so it must render its own <html> and
 *     <body>
 *   * it does NOT receive global styles — `app/globals.css` never loads — so
 *     Tailwind classes would silently do nothing. Every rule below is an inline
 *     style for that reason, and only for that reason. Do not "tidy" them into
 *     classes; they will vanish.
 *   * `metadata` is not supported in a Client Component, so the tab title is
 *     React's own <title> element
 *
 * It follows that this file may not import ErrorPanel, BrandMark, Button or
 * anything else in the design system: all of them are styled with Tailwind and
 * would render unstyled here. The duplication is the point — the one screen
 * that shows when everything else has failed depends on nothing that can fail.
 *
 * ---------------------------------------------------------------------------
 * WHEN IT ACTUALLY FIRES. A shell's own `error.tsx` catches failures in its
 * pages, but NOT in its layout — and the shop, rider and admin layouts are
 * where `requireUser()` and the shell queries run. A throw there lands here.
 * So this is not a theoretical file; it is the boundary for the auth path.
 *
 * BOTH LANGUAGES, NO PROVIDER. I18nProvider lives inside the shell layouts, so
 * `useT()` is unavailable by definition at this depth and the locale cookie is
 * unreadable without a server render. Burmese and English are both printed
 * rather than guessed at — the reader finds the one they can read, which is
 * the same reasoning LanguageToggle is written on.
 *
 * The colour is `--brand-red` (#c62828) by value, since the token is defined in
 * a stylesheet that is not loaded here.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#ffffff',
          color: '#242424',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Myanmar", sans-serif',
        }}
      >
        <title>Mingalar Express</title>

        <main style={{ maxWidth: '26rem', textAlign: 'center' }}>
          <p
            style={{
              fontWeight: 900,
              fontStyle: 'italic',
              textTransform: 'uppercase',
              letterSpacing: '-0.02em',
              fontSize: '22px',
              color: '#c62828',
              margin: 0,
            }}
          >
            Mingalar<span style={{ color: '#242424', fontSize: '11px' }}> EXPRESS</span>
          </p>

          <h1 style={{ fontSize: '18px', margin: '20px 0 0' }}>Something went wrong</h1>
          {/* Myanmar needs the extra leading for stacked diacritics; globals.css
              is not loaded here, so the rule is repeated inline. */}
          <p lang="my" style={{ fontSize: '16px', margin: '4px 0 0', lineHeight: 1.9 }}>
            တစ်ခုခု မှားယွင်းသွားပါသည်
          </p>

          <p style={{ fontSize: '14px', color: '#6b6b70', margin: '16px 0 0' }}>
            The app could not start this screen. Nothing was lost — your parcels and your
            money are safe.
          </p>
          <p
            lang="my"
            style={{ fontSize: '14px', color: '#6b6b70', margin: '8px 0 0', lineHeight: 1.9 }}
          >
            ဤစာမျက်နှာကို မဖွင့်နိုင်ပါ။ သင့်ပါဆယ်များနှင့် ငွေကြေး မထိခိုက်ပါ။
          </p>

          {/* 56px, the same floor the rest of the app uses for a primary action
              on a phone — and here it is the only control on the screen. */}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: '24px',
              width: '100%',
              minHeight: '56px',
              borderRadius: '10px',
              border: 'none',
              background: '#c62828',
              color: '#ffffff',
              fontSize: '16px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Try again · ထပ်စမ်းကြည့်ရန်
          </button>

          {/*
            A plain anchor, not a <Link>: next/link needs the router, and the
            router is part of what may have failed. This forces a real
            navigation, which is the recovery we actually want here.
          */}
          <p style={{ margin: '16px 0 0', fontSize: '14px' }}>
            <a href="/contact" style={{ color: '#c62828' }}>
              Call the office · ရုံးကို ဖုန်းခေါ်ရန်
            </a>
          </p>

          {error.digest ? (
            <p
              style={{
                marginTop: '20px',
                fontSize: '11px',
                color: '#6b6b70',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  )
}
