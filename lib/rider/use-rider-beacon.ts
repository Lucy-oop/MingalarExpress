'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { setRiderOnline } from '@/lib/rider/actions'

/**
 * Rider presence + position.
 *
 * Two channels on purpose, and this split is the whole reason the board scales:
 *
 *   - Realtime PRESENCE gets every GPS fix (a few per minute, free, ephemeral).
 *     Live tracking reads this.
 *   - The DATABASE gets one write per 20 s via `rider_heartbeat`. That is what
 *     the online indicator reads, so it has to be reasonably fresh — but
 *     publishing every fix to Postgres would put ~170k WAL events a day through
 *     replication for data that is worthless five minutes later.
 *
 * `rider_profiles` is deliberately absent from the Realtime publication for the
 * same reason (migration 0005 §8).
 */

export const HEARTBEAT_MS = 20_000
const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 5_000,
  timeout: 15_000,
}

export type BeaconState = {
  online: boolean
  position: { lat: number; lng: number; accuracy: number } | null
  geoError: string | null
  pending: boolean
  lastSentAt: number | null
}

export function useRiderBeacon(riderId: string, initialOnline: boolean) {
  const supabase = useRef(createClient()).current
  const [online, setOnline] = useState(initialOnline)
  const [position, setPosition] = useState<BeaconState['position']>(null)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [lastSentAt, setLastSentAt] = useState<number | null>(null)

  // Refs so the geolocation callback never re-subscribes on every fix.
  const positionRef = useRef<BeaconState['position']>(null)
  const lastDbWriteRef = useRef(0)

  const sendHeartbeat = useCallback(
    async (isOnline: boolean, force = false) => {
      const now = Date.now()
      if (!force && now - lastDbWriteRef.current < HEARTBEAT_MS) return
      lastDbWriteRef.current = now
      const p = positionRef.current
      const result = await setRiderOnline(isOnline, p?.lat, p?.lng)
      if (result.ok) setLastSentAt(Date.now())
    },
    [],
  )

  /** Toggle. Writes through immediately — a rider tapping "Go online" must not wait 20 s. */
  const toggle = useCallback(
    async (next: boolean) => {
      setPending(true)
      setOnline(next)
      const result = await setRiderOnline(next, positionRef.current?.lat, positionRef.current?.lng)
      setPending(false)
      if (!result.ok) {
        setOnline(!next) // roll back the optimistic flip
        return result
      }
      lastDbWriteRef.current = Date.now()
      setLastSentAt(Date.now())
      return result
    },
    [],
  )

  // ---- geolocation watch -------------------------------------------------
  useEffect(() => {
    if (!online) {
      setPosition(null)
      positionRef.current = null
      return
    }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGeoError('This device cannot share its location.')
      return
    }

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        setGeoError(null)
        const next = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }
        positionRef.current = next
        setPosition(next)
      },
      (error) => {
        setGeoError(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission denied. Dispatch cannot see you.'
            : 'Cannot get a GPS fix right now.',
        )
      },
      GEO_OPTIONS,
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [online])

  // ---- presence channel --------------------------------------------------
  useEffect(() => {
    if (!online) return
    const channel = supabase.channel('dispatch:live', {
      config: { presence: { key: riderId } },
    })

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void channel.track({ riderId, ...(positionRef.current ?? {}), ts: Date.now() })
      }
    })

    // Push presence on a short cadence; it is ephemeral and costs no WAL.
    const id = setInterval(() => {
      void channel.track({ riderId, ...(positionRef.current ?? {}), ts: Date.now() })
    }, 5_000)

    return () => {
      clearInterval(id)
      void channel.untrack()
      void supabase.removeChannel(channel)
    }
  }, [supabase, riderId, online])

  // ---- 20 s database heartbeat -------------------------------------------
  useEffect(() => {
    if (!online) return
    void sendHeartbeat(true, true)
    const id = setInterval(() => void sendHeartbeat(true), HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [online, sendHeartbeat])

  /**
   * Best-effort "I'm gone" on tab close. `visibilitychange` rather than
   * `beforeunload`, which mobile Safari does not reliably fire.
   *
   * This is a courtesy, not a guarantee — the real protection is the stale-ping
   * filter in `nearby_available_riders`, which stops offering work to a rider
   * whose last heartbeat is over 10 minutes old however the app died.
   */
  useEffect(() => {
    if (!online) return
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void sendHeartbeat(true, true)
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [online, sendHeartbeat])

  return { online, position, geoError, pending, lastSentAt, toggle } as const
}
