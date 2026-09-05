'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { acceptPolicy } from '@/lib/legal/actions'
import { useT } from '@/components/shared/i18n-provider'

/**
 * Sizing shared by this button and the interstitial's footer, so accepting the
 * terms looks the same wherever it is offered.
 *
 * `size="touch"` is a fixed h-14 with `whitespace-nowrap`, which is the trap the
 * booking modal already fell into: a Burmese label that needs two lines gets
 * clipped, or forces the row wider than the panel. The height is a floor
 * instead, and the label may wrap -- 48px still clears the tap-target minimum
 * and it survives whatever a future wording turns out to be.
 *
 * `w-full sm:w-auto` because these stack on a phone and sit inline on a
 * desktop. Without it the page's button hangs off the right edge on mobile with
 * nothing beside it.
 */
export const POLICY_BTN =
  'h-auto min-h-12 w-full whitespace-normal px-5 py-2.5 text-sm leading-snug sm:w-auto'

/** Accept, from the permanent page rather than the interstitial. */
export function AcceptPolicyButton({
  policyKey,
  version,
}: {
  policyKey: string
  version: string
}) {
  const t = useT()
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  return (
    // Full width on a phone so the button is not a small target floating at the
    // right edge; right-aligned once there is room for it to be.
    <div className="space-y-2 sm:flex sm:flex-col sm:items-end">
      {error ? (
        <div className="w-full">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      <Button
        className={POLICY_BTN}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          const result = await acceptPolicy(policyKey, version)
          setBusy(false)
          if (result.ok) router.refresh()
          else setError(result.message)
        }}
      >
        {busy ? t('policy.accepting') : t('policy.accept')}
      </Button>
    </div>
  )
}
