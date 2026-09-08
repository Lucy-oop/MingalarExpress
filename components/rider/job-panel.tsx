'use client'

import { useEffect, useState } from 'react'
import type { OrderStatus, LatLng } from '@/types/domain'
import { JobActions } from '@/components/rider/job-actions'

/**
 * The state buttons for one job, and the GPS fix behind them.
 *
 * THE MAP USED TO BE HERE, and it was 152 KB of Leaflet for something a rider
 * never used. They read the address and tap Navigate, which hands off to
 * whatever maps app is on the phone; the embedded canvas only ever showed
 * "Loading map…" on Yangon mobile data, took 192px of a small screen, and
 * pushed the primary action below the fold. `MapCanvas` stays where somebody
 * genuinely PICKS a point — shop settings and admin coverage — and riders stop
 * downloading it.
 *
 * WHY THE GPS FIX IS STILL HERE, and why it must not be tidied away with the
 * map: `advance_order` stamps this position onto `order_status_events`, which
 * is what makes a COD dispute answerable later. `JobActions` reads it at every
 * checkpoint. Removing it would not break a build or fail a test — a rider's
 * checkpoints would simply stop carrying a location, and nobody would find out
 * until somebody's money was in question.
 *
 * The offer countdown left with the offer engine (0009). A rider now only ever
 * opens a parcel that is already theirs, so there is nothing to race.
 */
export function JobPanel({
  orderId,
  orderCode,
  status,
  leg,
  customerName,
  codAmount,
  kpayAccount,
}: {
  orderId: string
  orderCode: string
  status: OrderStatus
  leg?: 'delivery' | 'pickup' | 'return' | null
  customerName: string
  codAmount: number
  kpayAccount: { name: string | null; phone: string | null; qrUrl: string }
}) {
  const [position, setPosition] = useState<LatLng | null>(null)

  // One-shot fix rather than a watch: the beacon on the dashboard already keeps
  // a continuous watch running, and two watchers double the GPS drain.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setPosition({ lat: coords.latitude, lng: coords.longitude }),
      () => setPosition(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }, [])

  return (
    <JobActions
      orderId={orderId}
      orderCode={orderCode}
      status={status}
      leg={leg}
      customerName={customerName}
      position={position}
      codAmount={codAmount}
      kpayAccount={kpayAccount}
    />
  )
}
