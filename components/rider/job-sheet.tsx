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
  customerName,
  pickup,
  dropoff,
}: {
  orderId: string
  orderCode: string
  status: OrderStatus
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

  const focus = status === 'picked_up' ? dropoff : pickup

  return (
    <div className="space-y-3">
      <div className="h-48 overflow-hidden rounded-lg border">
        <MapCanvas
          center={focus}
          zoom={16}
          clampToServiceArea={false}
          markers={[
            { id: 'pickup', point: pickup, kind: 'pickup', label: 'Pickup', emphasis: status !== 'picked_up' },
            { id: 'dropoff', point: dropoff, kind: 'dropoff', label: 'Delivery', emphasis: status === 'picked_up' },
            ...(position ? [{ id: 'me', point: position, kind: 'rider' as const, label: 'You' }] : []),
          ]}
        />
      </div>

      <JobActions
        orderId={orderId}
        orderCode={orderCode}
        status={status}
        customerName={customerName}
        position={position}
      />
    </div>
  )
}
