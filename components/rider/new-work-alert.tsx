'use client'

import { useEffect, useRef, useState } from 'react'
import { PackagePlus, X } from 'lucide-react'
import { alertNewWork, arm } from '@/lib/notify/chime'
import { localeNumber } from '@/lib/i18n'
import { useLocale, useT } from '@/components/shared/i18n-provider'
import { Button } from '@/components/ui/button'

/**
 * "+2 to deliver" — the chime, the buzz and the banner when dispatch adds work.
 *
 * WHAT THIS IS NOT: a push notification. It fires only while the app is open,
 * which is the honest limit of what can be built without VAPID keys, a
 * subscriptions table, and — on iOS — the rider having installed the PWA to
 * their home screen. It covers the common case (phone awake, app open at the
 * hub while loading) and nothing more; real push is a separate piece of work.
 *
 * THE COUNT IS COMPARED, NOT THE EVENT. Realtime already refreshes the feed, so
 * this watches the number arrive rather than subscribing again — one source of
 * truth for "how many parcels do I have", and no chance of the sound and the
 * list disagreeing.
 *
 * The first render never fires: `previous` starts as null, not zero, or every
 * rider would be chimed at on opening the app.
 */
export function NewWorkAlert({
  count,
}: {
  count: number
}) {
  const locale = useLocale()
  const t = useT()
  const previous = useRef<number | null>(null)
  const [added, setAdded] = useState<number | null>(null)

  // Arm the audio on the first touch anywhere. Mobile browsers refuse to start
  // sound before a gesture, and a rider who opens the app and pockets the phone
  // has made none.
  useEffect(() => {
    const onFirstTouch = () => arm()
    document.addEventListener('pointerdown', onFirstTouch, { once: true, passive: true })
    document.addEventListener('keydown', onFirstTouch, { once: true })
    return () => {
      document.removeEventListener('pointerdown', onFirstTouch)
      document.removeEventListener('keydown', onFirstTouch)
    }
  }, [])

  useEffect(() => {
    const before = previous.current
    previous.current = count
    if (before === null || count <= before) return

    setAdded(count - before)
    alertNewWork()
  }, [count])

  useEffect(() => {
    if (added === null) return
    // Long enough to notice from a bike, short enough not to sit over the list.
    const timer = setTimeout(() => setAdded(null), 12_000)
    return () => clearTimeout(timer)
  }, [added])

  if (added === null) return null

  return (
    <div
      role="status"
      aria-live="assertive"
      className="flex items-center gap-3 rounded-xl border-2 border-emerald-500 bg-emerald-50 p-4"
    >
      <PackagePlus className="size-7 shrink-0 text-emerald-700" aria-hidden="true" />
      <p className="flex-1 text-lg font-bold text-emerald-900">
        {added === 1
          ? t('jobs.newWorkOne')
          : t('jobs.newWork', { n: localeNumber(locale, added) })}
      </p>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setAdded(null)}
        aria-label={t('action.cancel')}
      >
        <X />
      </Button>
    </div>
  )
}
