'use client'

import dynamic from 'next/dynamic'
import type { MapCanvasProps } from './map-canvas'

/**
 * The only sanctioned entry point to the map.
 *
 * `ssr: false` is mandatory, not an optimisation: Leaflet dereferences `window`
 * while its module body evaluates, so any server render of it throws. Because
 * `dynamic(..., { ssr: false })` is itself only allowed in a Client Component,
 * this file carries 'use client' and every consumer imports from here.
 */
export const MapCanvas = dynamic<MapCanvasProps>(() => import('./map-canvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
})

export type { MapCanvasProps, MapFocus, MapMarker } from './map-canvas'
