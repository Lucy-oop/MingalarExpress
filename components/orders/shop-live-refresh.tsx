'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Keeps a shop screen current without a refresh button.
 *
 * A shop watches this page waiting for "picked up" and "delivered", and those
 * transitions are made by someone else entirely — a rider's phone, or a
 * dispatcher loading a run. Without a subscription the only way to learn about
 * them is to reload, which is exactly the moment a shop decides the app is not
 * telling them the truth.
 *
 * Renders nothing. `orders` is in the `supabase_realtime` publication (0005) and
 * the payload is RLS-filtered by `orders_read_shop`, so a shop is only woken by
 * its own parcels.
 *
 * Events are coalesced on a short timer for the same reason the dispatcher board
 * does it (`components/routes/route-board.tsx`): loading twenty parcels onto a
 * run emits twenty UPDATEs in one transaction, and twenty `router.refresh()`
 * calls would be twenty full re-renders of this page.
 */
export function ShopLiveRefresh() {
  const router = useRouter()

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
      .channel('shop-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, nudge)
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [router])

  return null
}
