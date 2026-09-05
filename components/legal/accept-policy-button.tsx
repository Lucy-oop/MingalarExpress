'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { acceptPolicy } from '@/lib/legal/actions'
import { useT } from '@/components/shared/i18n-provider'

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
    <div className="space-y-2">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        size="touch"
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
