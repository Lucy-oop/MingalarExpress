'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { PolicyDocumentView } from '@/components/legal/policy-document'
import { LanguageToggle } from '@/components/shared/language-toggle'
import { acceptPolicy } from '@/lib/legal/actions'
import { signOut } from '@/lib/auth/actions'
import { isScrolledToEnd } from '@/lib/legal/gate'
import { useLocale, useT } from '@/components/shared/i18n-provider'
import { cn } from '@/lib/utils'
import type { PolicyDocument } from '@/lib/legal/cod-advance'

/**
 * The terms, before anything else.
 *
 * A shop reads the COD advance policy, scrolls to the end, ticks that they have
 * read it, and continues. Nothing behind this is reachable until they do — no
 * dashboard, no nav, no New Order.
 *
 * WHY BLOCKING NOW, having argued against it. The earlier version offered
 * "Accept" or "Read later" and gated nothing, on the grounds that COD advance
 * is opt-in and its flow does not exist in the schema yet. That reasoning still
 * holds on its own terms and is outweighed by a business one: the office wants
 * every shop operating under the same agreement before they start, and partial
 * coverage means you cannot say "all our shops agreed" — which is the only
 * claim the record exists to support.
 *
 * WHY A CHECKBOX AND A SCROLL, not just a button. Clause 6 puts fraud losses on
 * the shop and clause 8 says advanced COD is not their money yet. "They clicked
 * Accept" is a weak thing to rely on; "the whole document was put in front of
 * them and they affirmed they had read it" is not. The scroll requirement costs
 * one listener and is the difference between the two.
 *
 * WHY SIGN OUT IS IN HERE. The header is behind this and unreachable. A shop
 * that wants to read eleven clauses of liability with a colleague, or their
 * lawyer, before agreeing must be able to leave — a gate is not a trap.
 */
export function PolicyGate({ doc }: { doc: PolicyDocument }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()

  const [read, setRead] = React.useState(false)
  const [confirmed, setConfirmed] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const scrollRef = React.useRef<HTMLDivElement>(null)

  const measure = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (isScrolledToEnd(el.scrollTop, el.clientHeight, el.scrollHeight)) setRead(true)
  }, [])

  /*
    Measured once on mount as well as on scroll. On a tall desktop window the
    document may already be fully visible, and a reader who never scrolls
    because there is nothing to scroll must not be stranded — isScrolledToEnd
    answers true for content shorter than its container, but only if something
    asks it.
  */
  React.useEffect(() => {
    measure()
  }, [measure])

  const accept = async () => {
    setBusy(true)
    setError(null)
    const result = await acceptPolicy(doc.key, doc.version)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    router.refresh()
  }

  return (
    /*
      Not the shared Overlay: that one is built to be dismissed — Escape, a
      backdrop click and a close button are all wired into it — and every one of
      those is wrong here. This is opaque rather than a scrim, because there is
      nothing behind it worth glimpsing yet.
    */
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-gate-title"
    >
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {doc.brand}
          </p>
          <h1 id="policy-gate-title" className="truncate text-base font-bold">
            {t('policy.title')}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LanguageToggle locale={locale} />
          {/* Not a trap: a shop may leave and come back having read it. */}
          <form action={signOut}>
            <Button variant="ghost" size="sm" type="submit" aria-label={t('action.signOut')}>
              <LogOut />
              <span className="hidden sm:inline">{t('action.signOut')}</span>
            </Button>
          </form>
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={measure}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        tabIndex={0}
        aria-label={doc.title}
      >
        <div className="mx-auto max-w-3xl">
          <PolicyDocumentView doc={doc} />
        </div>
      </div>

      <footer className="space-y-3 border-t px-4 py-3">
        <div className="mx-auto max-w-3xl space-y-3">
          {error ? <Alert tone="error">{error}</Alert> : null}

          {/* Until they reach the bottom, the only thing on offer is the reason
              they cannot continue yet. */}
          {read ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 size-5 shrink-0 accent-brand-red"
              />
              <span className="font-medium">{t('policy.readAll')}</span>
            </label>
          ) : (
            <p className="flex items-center justify-center gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <ArrowDown className="size-4 shrink-0 animate-bounce" aria-hidden="true" />
              {t('policy.scrollHint')}
            </p>
          )}

          <Button
            block
            size="touch"
            className={cn('h-auto min-h-12 whitespace-normal py-2.5 text-base leading-snug')}
            disabled={!read || !confirmed || busy}
            onClick={() => void accept()}
          >
            {busy ? t('policy.accepting') : t('policy.continue')}
          </Button>
        </div>
      </footer>
    </div>
  )
}
