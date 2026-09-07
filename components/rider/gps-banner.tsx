'use client'

import { useCallback, useEffect, useState } from 'react'
import { MapPinOff } from 'lucide-react'
import { useT } from '@/components/shared/i18n-provider'
import { Button } from '@/components/ui/button'

/**
 * Unmissable, and on every rider screen.
 *
 * WHAT IT REPLACES. A denied permission produced one `text-xs` amber line
 * inside `OnlineToggle`, in hardcoded English, on the dashboard only — and only
 * while the rider was online, because the beacon returns early when they are
 * not. The job page was worse: it does a one-shot `getCurrentPosition` and on
 * any error just sets the position to null, silently, so a rider completed
 * checkpoint after checkpoint with no coordinates and nothing telling them.
 *
 * WHY THAT MATTERS more than it looks. Dispatch places work by where a rider
 * is, and every checkpoint stamps a coordinate onto `order_status_events`. A
 * blocked permission is not a degraded experience — it is a rider the office
 * cannot see and a delivery with no evidence of place, discovered weeks later
 * when somebody disputes it.
 *
 * ASKED OF THE PERMISSION, NOT THE BEACON. `navigator.permissions` reports the
 * state whether or not the rider is on shift, so this works off-shift and
 * offline. Where `permissions` is unavailable — older WebViews — it falls back
 * to a one-shot probe and shows nothing unless that probe is actually refused,
 * because a banner nobody can act on is worse than none.
 *
 * ONCE ALREADY DENIED, A BROWSER WILL NOT RE-PROMPT. So the button is offered
 * while the state is `prompt`, and instructions replace it once it is `denied`.
 * Telling a rider to tap a button that cannot work is how they stop believing
 * the app.
 */
type State = 'unknown' | 'granted' | 'prompt' | 'denied'

export function GpsBanner() {
  const t = useT()
  const [state, setState] = useState<State>('unknown')
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    let live = true
    if (typeof navigator === 'undefined') return

    const perms = navigator.permissions
    if (!perms?.query) {
      // No Permissions API. Probe once; stay silent unless refused outright,
      // since we cannot distinguish "not asked yet" from "granted" here.
      if (!('geolocation' in navigator)) return
      navigator.geolocation.getCurrentPosition(
        () => live && setState('granted'),
        (e) => live && setState(e.code === e.PERMISSION_DENIED ? 'denied' : 'granted'),
        { timeout: 10_000, maximumAge: 600_000 },
      )
      return
    }

    let status: PermissionStatus | null = null
    const onChange = () => live && status && setState(status.state as State)

    perms
      .query({ name: 'geolocation' as PermissionName })
      .then((s) => {
        if (!live) return
        status = s
        setState(s.state as State)
        s.addEventListener('change', onChange)
      })
      .catch(() => {
        /* Some browsers reject the query outright. Say nothing. */
      })

    return () => {
      live = false
      status?.removeEventListener('change', onChange)
    }
  }, [])

  const ask = useCallback(() => {
    setAsking(true)
    navigator.geolocation.getCurrentPosition(
      () => {
        setState('granted')
        setAsking(false)
      },
      () => setAsking(false),
      { timeout: 15_000 },
    )
  }, [])

  if (state === 'unknown' || state === 'granted') return null

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border-2 border-destructive bg-destructive/10 p-3"
    >
      <MapPinOff className="mt-0.5 size-6 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-base font-bold text-destructive">{t('gps.denied')}</p>
        <p className="text-sm">{t('gps.deniedWhy')}</p>
        {state === 'prompt' ? (
          <Button size="touch" block variant="destructive" disabled={asking} onClick={ask}>
            {t('gps.allow')}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{t('gps.howTo')}</p>
        )}
      </div>
    </div>
  )
}
