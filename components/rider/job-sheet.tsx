'use client'

import { useEffect, useState } from 'react'
import { MapCanvas } from '@/components/map'
import { JobActions } from '@/components/rider/job-actions'
import type { LatLng, OrderStatus } from '@/types/domain'

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
}: {
  orderId: string
  orderCode: string
  status: OrderStatus
  leg?: 'delivery' | 'pickup' | 'return' | null
  customerName: string
  pickup: LatLng
  dropoff: LatLng
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

  // On a return the rider is heading to the shop, so the pickup point is the
  // destination and the customer's address is irrelevant.
  const focus = leg === 'return' ? pickup : status === 'picked_up' ? dropoff : pickup

  return (
    <div className="space-y-3">
      <div className="h-48 overflow-hidden rounded-lg border">
        <MapCanvas
          center={focus}
          zoom={16}
          clampToServiceArea={false}
          markers={[
            // The shop pin goes once the parcel is aboard: the rider is
            // delivering now, and on a return leg the shop is already the
            // destination pin below.
            ...(leg !== 'return' && status === 'assigned'
              ? [{ id: 'pickup', point: pickup, kind: 'pickup' as const, label: 'Pickup', emphasis: true }]
              : []),
            {
              id: 'dropoff',
              point: leg === 'return' ? pickup : dropoff,
              kind: 'dropoff' as const,
              label: leg === 'return' ? 'Back to shop' : 'Delivery',
              emphasis: status === 'picked_up' || leg === 'return',
            },
            ...(position ? [{ id: 'me', point: position, kind: 'rider' as const, label: 'You' }] : []),
          ]}
        />
      </div>

      <JobActions
        orderId={orderId}
        orderCode={orderCode}
        status={status}
        leg={leg}
        customerName={customerName}
        position={position}
      />
    </div>
  )
}
