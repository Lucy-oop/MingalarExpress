'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { PolicyDocumentView } from '@/components/legal/policy-document'
import { acceptPolicy } from '@/lib/legal/actions'
import { POLICY_BTN } from '@/components/legal/accept-policy-button'
import { useT } from '@/components/shared/i18n-provider'
import type { PolicyDocument } from '@/lib/legal/cod-advance'

/**
 * Shows a policy the signed-in user has not yet accepted.
 *
 * IT DOES NOT BLOCK THE PANEL, and that is deliberate. COD advance is an opt-in
 * service and there is no advance flow in the schema at all yet, so holding a
 * shop's parcel booking hostage to terms for a feature that does not exist
 * would be disproportionate. "Later" defers it for this browser session; it
 * returns next visit, and it is permanently linked from Shop settings. If the
 * office later wants a hard gate, the honest place for it is the COD advance
 * request itself -- refuse the advance, not the delivery.
 *
 * DISMISSAL IS NOT ACCEPTANCE. Escape and the backdrop both mean "later", never
 * "agreed": only the Accept button writes a row. That is the opposite of the
 * booking dialog's convention next door, where dismissing means "create
 * another" -- here the safe default has to be that nothing was agreed.
 */
export function PolicyGate({ doc }: { doc: PolicyDocument }) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Per session, per version. Read in an effect rather than in the initial
  // state so the server and the first client render agree -- sessionStorage
  // does not exist during SSR, and reading it inline would hydrate-mismatch.
  const deferKey = `mge:policy:later:${doc.key}:${doc.version}`
  React.useEffect(() => {
    let deferred = false
    try {
      deferred = window.sessionStorage.getItem(deferKey) === '1'
    } catch {
      // Private mode, or storage blocked. Showing the terms is the safe
      // direction, so a failed read simply means we ask.
    }
    setOpen(!deferred)
  }, [deferKey])

  const later = () => {
    try {
      window.sessionStorage.setItem(deferKey, '1')
    } catch {
      // Nothing to do: it will be asked again on the next page, which is
      // annoying but not wrong.
    }
    setOpen(false)
  }

  const accept = async () => {
    setBusy(true)
    setError(null)
    const result = await acceptPolicy(doc.key, doc.version)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setOpen(false)
    router.refresh()
  }

  if (!open) return null

  return (
    <Overlay
      open
      side="center"
      title={t('policy.title')}
      onClose={later}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <Button variant="ghost" className={POLICY_BTN} onClick={later} disabled={busy}>
            {t('policy.later')}
          </Button>
          <Button className={POLICY_BTN} onClick={() => void accept()} disabled={busy}>
            {busy ? t('policy.accepting') : t('policy.accept')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <PolicyDocumentView doc={doc} />
        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>
    </Overlay>
  )
}
