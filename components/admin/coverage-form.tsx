'use client'

import { useActionState, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Crosshair, Save } from 'lucide-react'
import { MapCanvas, type MapMarker } from '@/components/map'
import { updateCoverage, type AdminResult } from '@/lib/admin/actions'
import { THINGANGYUN_BBOX, THINGANGYUN_CENTER } from '@/lib/geo/thingangyun'
import type { AppSettings, LatLng } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round6 = (v: number) => Math.round(v * 1e6) / 1e6

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      <Save />
      {pending ? 'Saving…' : 'Save coverage & base'}
    </Button>
  )
}

export function CoverageForm({ settings }: { settings: AppSettings }) {
  const [state, action] = useActionState<AdminResult, FormData>(updateCoverage, {
    ok: false,
    message: '',
  })
  const err = (k: string) => (state.ok ? undefined : state.fieldErrors?.[k]?.[0])

  const [box, setBox] = useState({
    south: Number(settings.bbox_south),
    north: Number(settings.bbox_north),
    west: Number(settings.bbox_west),
    east: Number(settings.bbox_east),
  })
  const [base, setBase] = useState<LatLng>({
    lat: Number(settings.map_center_lat),
    lng: Number(settings.map_center_lng),
  })
  const [zoom, setZoom] = useState(Number(settings.map_default_zoom))
  const [placing, setPlacing] = useState(false)

  /**
   * Corner drags are clamped to the HARD geofence — `public.in_service_area()`
   * is a CHECK constraint, so anything outside it can only ever be rejected by
   * Postgres. Clamping in the handler means the map cannot express a box the
   * database would refuse, and the server-side schema refuses it again anyway.
   */
  function moveCorner(corner: 'sw' | 'ne', p: LatLng) {
    setBox((b) => {
      const lat = clamp(p.lat, THINGANGYUN_BBOX.south, THINGANGYUN_BBOX.north)
      const lng = clamp(p.lng, THINGANGYUN_BBOX.west, THINGANGYUN_BBOX.east)
      return corner === 'sw'
        ? { ...b, south: round6(Math.min(lat, b.north - 0.001)), west: round6(Math.min(lng, b.east - 0.001)) }
        : { ...b, north: round6(Math.max(lat, b.south + 0.001)), east: round6(Math.max(lng, b.west + 0.001)) }
    })
  }

  const markers = useMemo<MapMarker[]>(
    () => [
      {
        id: 'base',
        point: base,
        kind: 'pickup',
        label: 'Base location',
        draggable: true,
        emphasis: true,
        onDragEnd: (p) => setBase({ lat: round6(p.lat), lng: round6(p.lng) }),
      },
      {
        id: 'sw',
        point: { lat: box.south, lng: box.west },
        kind: 'dropoff',
        label: 'South-west corner',
        draggable: true,
        onDragEnd: (p) => moveCorner('sw', p),
      },
      {
        id: 'ne',
        point: { lat: box.north, lng: box.east },
        kind: 'dropoff',
        label: 'North-east corner',
        draggable: true,
        onDragEnd: (p) => moveCorner('ne', p),
      },
    ],
    [base, box],
  )

  const baseOutsideBox =
    base.lat < box.south || base.lat > box.north || base.lng < box.west || base.lng > box.east

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.message ? <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert> : null}

      <Alert tone="info">
        These are the <strong>soft</strong> bounds the UI checks a pin against. The hard geofence is
        the SQL <code>in_service_area()</code> CHECK ({THINGANGYUN_BBOX.south}–
        {THINGANGYUN_BBOX.north} N, {THINGANGYUN_BBOX.west}–{THINGANGYUN_BBOX.east} E) and it can
        only be widened by a migration — a CHECK constraint cannot read a table. So this box may be
        narrowed inside the geofence, never beyond it.
      </Alert>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm">Coverage box & base location</CardTitle>
            <Button
              type="button"
              size="sm"
              variant={placing ? 'default' : 'outline'}
              onClick={() => setPlacing((p) => !p)}
            >
              <Crosshair />
              {placing ? 'Click the map…' : 'Move base by click'}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[26rem] w-full">
              <MapCanvas
                center={base}
                zoom={zoom}
                markers={markers}
                clampToServiceArea
                onMapClick={
                  placing
                    ? (p) => {
                        setBase({ lat: round6(p.lat), lng: round6(p.lng) })
                        setPlacing(false)
                      }
                    : undefined
                }
                className="h-full w-full"
              />
            </div>
            <p className="border-t p-3 text-xs text-muted-foreground">
              Drag the red pin to move the base location, or the two gold corners to resize the
              coverage box. Corner drags are clamped to the geofence.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Coverage bounds</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="South" htmlFor="bboxSouth" required error={err('bboxSouth')}>
                <Input
                  id="bboxSouth"
                  name="bboxSouth"
                  type="number"
                  step="0.0001"
                  value={box.south}
                  onChange={(e) => setBox((b) => ({ ...b, south: Number(e.target.value) }))}
                  required
                  aria-invalid={!!err('bboxSouth')}
                />
              </Field>
              <Field label="North" htmlFor="bboxNorth" required error={err('bboxNorth')}>
                <Input
                  id="bboxNorth"
                  name="bboxNorth"
                  type="number"
                  step="0.0001"
                  value={box.north}
                  onChange={(e) => setBox((b) => ({ ...b, north: Number(e.target.value) }))}
                  required
                  aria-invalid={!!err('bboxNorth')}
                />
              </Field>
              <Field label="West" htmlFor="bboxWest" required error={err('bboxWest')}>
                <Input
                  id="bboxWest"
                  name="bboxWest"
                  type="number"
                  step="0.0001"
                  value={box.west}
                  onChange={(e) => setBox((b) => ({ ...b, west: Number(e.target.value) }))}
                  required
                  aria-invalid={!!err('bboxWest')}
                />
              </Field>
              <Field label="East" htmlFor="bboxEast" required error={err('bboxEast')}>
                <Input
                  id="bboxEast"
                  name="bboxEast"
                  type="number"
                  step="0.0001"
                  value={box.east}
                  onChange={(e) => setBox((b) => ({ ...b, east: Number(e.target.value) }))}
                  required
                  aria-invalid={!!err('bboxEast')}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Base location</CardTitle>
              <p className="text-xs text-muted-foreground">
                Where every map opens: the dispatch board, the order picker and the rider PWA.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Latitude"
                  htmlFor="mapCenterLat"
                  required
                  error={err('mapCenterLat')}
                >
                  <Input
                    id="mapCenterLat"
                    name="mapCenterLat"
                    type="number"
                    step="0.000001"
                    value={base.lat}
                    onChange={(e) => setBase((b) => ({ ...b, lat: Number(e.target.value) }))}
                    required
                    aria-invalid={!!err('mapCenterLat')}
                  />
                </Field>
                <Field label="Longitude" htmlFor="mapCenterLng" required error={err('mapCenterLng')}>
                  <Input
                    id="mapCenterLng"
                    name="mapCenterLng"
                    type="number"
                    step="0.000001"
                    value={base.lng}
                    onChange={(e) => setBase((b) => ({ ...b, lng: Number(e.target.value) }))}
                    required
                    aria-invalid={!!err('mapCenterLng')}
                  />
                </Field>
              </div>

              <Field
                label="Default zoom"
                htmlFor="mapDefaultZoom"
                required
                hint="10 – 19. 14 shows the whole township."
                error={err('mapDefaultZoom')}
              >
                <Input
                  id="mapDefaultZoom"
                  name="mapDefaultZoom"
                  type="number"
                  min="10"
                  max="19"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  required
                  aria-invalid={!!err('mapDefaultZoom')}
                />
              </Field>

              {baseOutsideBox ? (
                <Alert tone="error">
                  The base location is outside the coverage box. Move it back inside, or the map
                  will open on tiles you do not serve.
                </Alert>
              ) : null}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setBase(THINGANGYUN_CENTER)
                  setBox(THINGANGYUN_BBOX)
                  setZoom(14)
                }}
              >
                Reset to township defaults
              </Button>
            </CardContent>
          </Card>

          <SaveButton />
        </div>
      </div>
    </form>
  )
}
