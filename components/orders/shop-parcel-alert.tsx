'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PackageCheck, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { alertNewWork, arm } from '@/lib/notify/chime'
import {
  alertMessage,
  isPickupEdge,
  mergeTally,
  pickupKind,
  tallyTotal,
  EMPTY_TALLY,
  type AlertTally,
  type OrderRowLike,
} from '@/lib/orders/parcel-alert'
import { localeNumber } from '@/lib/i18n'
import { useLocale, useT } from '@/components/shared/i18n-provider'
import { Button } from '@/components/ui/button'

/**
 * Tells a shop the moment a rider takes one of their parcels.
 *
 * REPLACES `ShopLiveRefresh`, rather than sitting beside it. That component did
 * the same subscription and the same debounced `router.refresh()`, so running
 * both would open two sockets and refresh twice for every event. It was also
 * mounted on only two of the six shop pages; this one goes in the layout, so a
 * shop hears about a collection while they are on the booking form adding the
 * next parcel — which is exactly when they are looking at the screen.
 *
 * WHAT IT IS NOT: push. It fires while a shop page is open, and the catch-up
 * count below covers the gap when one is reopened. Reaching a shop whose phone
 * is in a drawer needs Web Push — VAPID keys, a subscriptions table, and on iOS
 * the PWA installed — which is a separate piece of work.
 *
 * The pattern is the rider's `NewWorkAlert`: derive from data rather than
 * subscribe twice, never fire on first render, chime armed on a real gesture,
 * and let every layer degrade silently.
 */

/** Per-user, because two shop owners can share a browser. */
const seenKey = (userId: string) => `mge:shop:seenPickup:${userId}`

export function ShopParcelAlert({ userId }: { userId: string }) {
  const router = useRouter()
  const t = useT()
  const locale = useLocale()
  const [tally, setTally] = useState<AlertTally>(EMPTY_TALLY)
  const [fromCatchUp, setFromCatchUp] = useState(false)

  /**
   * The high-water mark, advanced only when the banner is DISMISSED.
   *
   * Advancing it on mount would lose the news for a shop that opened the app and
   * looked away; advancing it on display would re-show nothing after a reload
   * they never read. Dismissal is the only moment we know they saw it.
   */
  const markSeen = useCallback(() => {
    try {
      window.localStorage.setItem(seenKey(userId), new Date().toISOString())
    } catch {
      // Private mode, or storage disabled. The banner still worked; only the
      // catch-up on next visit is lost.
    }
  }, [userId])

  const dismiss = useCallback(() => {
    setTally(EMPTY_TALLY)
    setFromCatchUp(false)
    markSeen()
  }, [markSeen])

  // Mobile browsers refuse to start audio before a gesture, and a shop that
  // opens the app and puts the phone down has made none.
  useEffect(() => {
    const onFirstTouch = () => arm()
    document.addEventListener('pointerdown', onFirstTouch, { once: true, passive: true })
    document.addEventListener('keydown', onFirstTouch, { once: true })
    return () => {
      document.removeEventListener('pointerdown', onFirstTouch)
      document.removeEventListener('keydown', onFirstTouch)
    }
  }, [])

  /**
   * What happened while the shop was away.
   *
   * A client-side read, so RLS scopes it to this shop without a new endpoint.
   * On a first-ever visit there is no mark: the mark is set and nothing is
   * shown, for the same reason the live path never fires on first render —
   * otherwise every shop is greeted by a summary of their entire history.
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      let since: string | null = null
      try {
        since = window.localStorage.getItem(seenKey(userId))
      } catch {
        return
      }
      if (!since) {
        markSeen()
        return
      }

      const supabase = createClient()
      const { data, error } = await supabase
        .from('orders')
        .select('trip_leg')
        .eq('status', 'picked_up')
        .gt('picked_up_at', since)
        .limit(50)
      if (cancelled || error || !data?.length) return

      const missed = data.reduce<AlertTally>((acc, row) => {
        const kind = pickupKind(row.trip_leg)
        if (!kind) return acc
        return kind === 'from_shop'
          ? { ...acc, fromShop: acc.fromShop + 1 }
          : { ...acc, toCustomer: acc.toCustomer + 1 }
      }, EMPTY_TALLY)

      if (tallyTotal(missed) === 0) return
      setFromCatchUp(true)
      setTally((current) => mergeTally(current, missed))
    })()
    return () => {
      cancelled = true
    }
  }, [userId, markSeen])

  /**
   * Live. One subscription doing both jobs: keep the page current, and notice
   * the collection edge.
   *
   * The refresh is debounced for the reason the dispatcher board debounces —
   * loading twenty parcels onto a run is twenty UPDATEs in one transaction — but
   * the ALERT is not, because each event carries its own row and the tally has
   * to see all of them.
   */
  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null

    const nudge = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        router.refresh()
      }, 400)
    }

    const channel = supabase
      .channel(`shop-parcels:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        nudge()

        // `orders` carries `replica identity full` (0005), so `old` is populated
        // and the edge into picked_up is detectable without a schema change.
        const before = payload.old as OrderRowLike | null
        const after = payload.new as OrderRowLike | null
        if (!isPickupEdge(before, after)) return

        const kind = pickupKind(after?.trip_leg)
        if (!kind) return

        setFromCatchUp(false)
        setTally((current) =>
          mergeTally(current, {
            fromShop: kind === 'from_shop' ? 1 : 0,
            toCustomer: kind === 'to_customer' ? 1 : 0,
          }),
        )
        alertNewWork()
      })
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [router, userId])

  const message = alertMessage(tally)

  // Long enough to notice from across a counter, short enough not to sit over
  // the page. Dismissing early is what advances the mark either way.
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(dismiss, 15_000)
    return () => clearTimeout(timer)
  }, [message, dismiss])

  /*
    THE LIVE REGION IS ALWAYS MOUNTED, and it is empty rather than absent when
    there is nothing to say.

    It used to `return null` and then render the role="status" element together
    with its text. Screen readers only announce MUTATIONS to a live region that
    was already in the accessibility tree; one that appears at the same instant
    as its content is routinely dropped by NVDA and VoiceOver. So the shop most
    in need of hearing "a rider has your parcel" was the one least likely to.

    An empty region also costs no layout: the spacing and the border belong to
    the banner inside it, never to the region itself. That is what lets the
    shell drop the wrapper div whose unconditional `pt-4` used to leave a dead
    band under the header on every page.
  */
  return (
    /*
      `print:hidden` on the REGION, not the banner: a live-region wrapper that
      is empty costs nothing on paper either way, but hiding it here covers the
      banner and anything later added beside it. "3 parcels delivered while you
      were away" is screen news, and it was landing at the top of the first
      waybill of a label run.
    */
    <div role="status" aria-live="polite" className="print:hidden">
      {message ? (
        <div className="mb-4 flex items-center gap-3 rounded-xl border-2 border-emerald-500 bg-emerald-50 p-3">
          <PackageCheck className="size-6 shrink-0 text-emerald-700" aria-hidden="true" />
          <p className="flex-1 text-base font-semibold text-emerald-900">
            {t(message.key, { n: localeNumber(locale, message.count) })}
            {fromCatchUp ? (
              <span className="ml-1 font-normal text-emerald-800">
                ({t('shop.alert.whileAway')})
              </span>
            ) : null}
          </p>
          <Button
            variant="ghost"
            size="icon"
            onClick={dismiss}
            aria-label={t('shop.alert.dismiss')}
          >
            <X />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
