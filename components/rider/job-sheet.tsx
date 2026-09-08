'use client'

import { useEffect, useState } from 'react'
import { MapCanvas } from '@/components/map'
import { JobActions } from '@/components/rider/job-actions'
import type { LatLng, OrderStatus } from '@/types/domain'
import { useT } from '@/components/shared/i18n-provider'

/**
 * Client half of the job page: the map and the state buttons.
 *
 * The offer countdown left with the offer engine (0009). A rider now only ever
 * opens a parcel that is already theirs, so there is nothing to race.
 *
 * Holds the GPS fix so each checkpoint carries the rider's actual position —
 * `advance_order` stamps it onto `order_status_events`, which is what makes a COD
 * dispute answerable later.
 */
export function JobSheet({
  orderId,
  orderCode,
  status,
  leg,
  customerName,
  pickup,
  dropoff,
  codAmount,
  kpayAccount,
}: {
  orderId: string
  orderCode: string
  status: OrderStatus
  leg?: 'delivery' | 'pickup' | 'return' | null
  customerName: string
  /**
   * NULL when the shop has no map pin (0034/0036). The map is HIDDEN in that
   * case rather than centred somewhere plausible: a map of the right ward with
   * no shop on it invites a rider to trust a pin that is not there, and on a
   * collection leg the only other point available is the customer — exactly
   * where they must not go yet.
   */
  pickup: LatLng | null
  dropoff: LatLng
  codAmount: number
  kpayAccount: { name: string | null; phone: string | null; qrUrl: string }
}) {
  const t = useT()
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

  /*
    On a return the rider is heading to the shop, so the pickup point is the
    destination and the customer's address is irrelevant. A COLLECTION is the
    same shape: the shop is where the job happens, and once the parcel is
    aboard the run ends at the hub — not at the customer. Without `pickup` here
    the map jumped across the city to somebody the rider must not visit yet.
  */
  const focus =
    leg === 'return' || leg === 'pickup'
      ? pickup
      : status === 'picked_up'
        ? dropoff
        : pickup

  /*
    NOTHING TO CENTRE ON. Only reachable on a collection or a return whose shop
    has no pin: an outbound delivery always has a dropoff, which is still NOT
    NULL. The address, the note and the CALL button are above this; a blank map
    would be the only thing lost, and a wrongly-centred one would be worse.
  */
  const mappable = focus !== null

  /*
    Built here rather than inline so a null point DROPS OUT instead of being
    passed to MapCanvas as `{ lat: null }`. `pickup` may be null even when
    `focus` is not -- an outbound delivery whose shop has no pin still centres
    on the customer -- so narrowing `focus` alone would not have been enough,
    and the marker would have rendered at the equator.
  */
  const destination = leg === 'return' ? pickup : dropoff
  const markers = [
    // The shop pin goes once the parcel is aboard: the rider is delivering
    // now, and on a return leg the shop is already the destination pin below.
    ...(leg !== 'return' && status === 'assigned' && pickup
      ? [
          {
            id: 'pickup',
            point: pickup,
            kind: 'pickup' as const,
            label: t('parcel.pickUp'),
            emphasis: true,
          },
        ]
      : []),
    ...(destination
      ? [
          {
            id: 'dropoff',
            point: destination,
            kind: 'dropoff' as const,
            label: leg === 'return' ? t('parcel.returnTo') : t('parcel.deliverTo'),
            emphasis: status === 'picked_up' || leg === 'return',
          },
        ]
      : []),
    ...(position ? [{ id: 'me', point: position, kind: 'rider' as const, label: 'You' }] : []),
  ]

  return (
    <div className="space-y-3">
      {mappable ? (
      <div className="h-48 overflow-hidden rounded-lg border">
        <MapCanvas
          center={focus}
          zoom={16}
          clampToServiceArea={false}
          markers={markers}
        />
      </div>
      ) : null}

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
    </div>
  )
}
