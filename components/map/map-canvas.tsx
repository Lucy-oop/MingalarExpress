'use client'

import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getMapProvider } from '@/lib/map/providers'
import { mapDefaults, THINGANGYUN_LEAFLET_BOUNDS } from '@/lib/geo/thingangyun'
import type { LatLng } from '@/types/domain'
import { cn } from '@/lib/utils'

/**
 * Leaflet shell. NEVER import this module directly from a Server Component --
 * Leaflet reads `window` at import time. Always go through the `ssr: false`
 * dynamic wrapper in ./index.ts.
 *
 * Leaflet's default marker icons resolve their own image URLs relative to the
 * CSS, which breaks under bundling. We build inline SVG divIcons instead, which
 * also lets the pins carry brand colour.
 */

export type MapMarker = {
  id: string
  point: LatLng
  kind: 'pickup' | 'dropoff' | 'rider' | 'rider_busy'
  label?: string
  draggable?: boolean
  onDragEnd?: (point: LatLng) => void
  /** Selected marker: drawn larger and above the rest. */
  emphasis?: boolean
  /** Faded, for context markers that are not the current focus. */
  muted?: boolean
  onClick?: () => void
}

const PIN_COLORS = {
  pickup: '#c62828',
  dropoff: '#d4a72c',
  rider: '#1d4ed8',
  rider_busy: '#71717a',
} as const

const PIN_GLYPH = {
  pickup: 'M',
  dropoff: '\u2605',
  rider: '\u25B2',
  rider_busy: '\u25B2',
} as const

function pinIcon(kind: MapMarker['kind'], emphasis = false, muted = false) {
  const color = PIN_COLORS[kind]
  const glyph = PIN_GLYPH[kind]
  const scale = emphasis ? 1.35 : 1
  const w = Math.round(30 * scale)
  const h = Math.round(40 * scale)
  const ring = emphasis
    ? '<circle cx="15" cy="14.5" r="13.2" fill="none" stroke="#fff" stroke-width="2.4"/>'
    : ''
  return L.divIcon({
    className: muted ? 'mge-pin-shadow mge-pin-muted' : 'mge-pin-shadow',
    html: `<svg width="${w}" height="${h}" viewBox="-2 -2 34 44" xmlns="http://www.w3.org/2000/svg">
      ${ring}
      <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.7 23.3 0 15 0z" fill="${color}"/>
      <circle cx="15" cy="14.5" r="8" fill="#fff"/>
      <text x="15" y="19" text-anchor="middle" font-size="11" font-weight="700" fill="${color}" font-family="system-ui,sans-serif">${glyph}</text>
    </svg>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    popupAnchor: [0, -h + 2],
  })
}

/** Keeps the Leaflet view in step with props without remounting the map. */
function ViewSync({ center, zoom }: { center?: LatLng; zoom?: number }) {
  const map = useMap()
  useEffect(() => {
    if (!center) return
    map.setView([center.lat, center.lng], zoom ?? map.getZoom(), { animate: true })
  }, [map, center?.lat, center?.lng, zoom])
  return null
}

/**
 * A one-shot animated flight, triggered by `nonce` rather than by coordinates.
 *
 * Keying on the coordinates would be wrong twice over: dragging the pin also
 * changes them, so every drag would yank the viewport, and picking the SAME
 * search result twice would not move at all. A caller bumping `nonce` is saying
 * "fly now", which is the actual intent.
 */
function FocusFly({ focus }: { focus?: MapFocus }) {
  const map = useMap()
  useEffect(() => {
    if (!focus) return
    const target: L.LatLngExpression = [focus.point.lat, focus.point.lng]
    const zoom = focus.zoom ?? map.getZoom()

    // A map that swoops is disorienting for anyone who asked the OS not to
    // animate; land on the same view without the flight.
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (reduced) map.setView(target, zoom, { animate: false })
    else map.flyTo(target, zoom, { duration: 0.8 })
    // Coordinates are read fresh on each firing; only the nonce schedules one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focus?.nonce])
  return null
}

/**
 * A map inside a container that starts hidden or resizes (a tab, a drawer)
 * renders as grey tiles until Leaflet is told to re-measure.
 */
function ResizeFix() {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 120)
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(map.getContainer())
    return () => {
      clearTimeout(t)
      observer.disconnect()
    }
  }, [map])
  return null
}

/** Imperative "fly here now", for a search result or a jump-to control. */
export type MapFocus = {
  point: LatLng
  zoom?: number
  /** Bump to re-trigger the flight, even to coordinates already shown. */
  nonce: number
}

export type MapCanvasProps = {
  center?: LatLng
  zoom?: number
  /** Animated jump. Independent of `center`, which only keeps the view in step. */
  focus?: MapFocus
  markers?: MapMarker[]
  className?: string
  /** Restrict panning to the township. On by default; off for the dispatch map. */
  clampToServiceArea?: boolean
  onMapClick?: (point: LatLng) => void
  interactive?: boolean
}

function ClickHandler({ onMapClick }: { onMapClick: (p: LatLng) => void }) {
  const map = useMap()
  useEffect(() => {
    const handler = (e: L.LeafletMouseEvent) =>
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng })
    map.on('click', handler)
    return () => {
      map.off('click', handler)
    }
  }, [map, onMapClick])
  return null
}

export default function MapCanvas({
  center,
  zoom,
  focus,
  markers = [],
  className,
  clampToServiceArea = true,
  onMapClick,
  interactive = true,
}: MapCanvasProps) {
  const provider = useMemo(() => getMapProvider(), [])
  const defaults = useMemo(() => mapDefaults(), [])
  const start = center ?? defaults.center

  return (
    <MapContainer
      center={[start.lat, start.lng]}
      zoom={zoom ?? defaults.zoom}
      maxBounds={clampToServiceArea ? THINGANGYUN_LEAFLET_BOUNDS : undefined}
      maxBoundsViscosity={clampToServiceArea ? 0.9 : 0}
      minZoom={clampToServiceArea ? 12 : 3}
      scrollWheelZoom={interactive}
      dragging={interactive}
      doubleClickZoom={interactive}
      zoomControl={interactive}
      className={cn('h-full w-full', className)}
    >
      <TileLayer
        url={provider.tileUrl}
        attribution={provider.attribution}
        maxZoom={provider.maxZoom}
      />
      <ResizeFix />
      <ViewSync center={center} zoom={zoom} />
      <FocusFly focus={focus} />
      {onMapClick ? <ClickHandler onMapClick={onMapClick} /> : null}

      {markers.map((m) => (
        <Marker
          key={m.id}
          position={[m.point.lat, m.point.lng]}
          icon={pinIcon(m.kind, m.emphasis, m.muted)}
          draggable={m.draggable}
          title={m.label}
          zIndexOffset={m.emphasis ? 1000 : m.muted ? -100 : 0}
          eventHandlers={{
            ...(m.draggable && m.onDragEnd
              ? {
                  dragend: (e: L.DragEndEvent) => {
                    const { lat, lng } = (e.target as L.Marker).getLatLng()
                    m.onDragEnd?.({ lat, lng })
                  },
                }
              : {}),
            ...(m.onClick ? { click: () => m.onClick?.() } : {}),
          }}
        />
      ))}
    </MapContainer>
  )
}
