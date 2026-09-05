'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Crosshair, LocateFixed, MapPin, Search, X } from 'lucide-react'
import { MapCanvas, type MapFocus } from '@/components/map'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import {
  forwardGeocode,
  reverseGeocode,
  MIN_QUERY_LENGTH,
  type GeocodeCandidate,
} from '@/lib/map/geocoder'
import { isInServiceArea, mapDefaults } from '@/lib/geo/thingangyun'
import type { LatLng } from '@/types/domain'
import { cn } from '@/lib/utils'

/**
 * The address, with the map behind it.
 *
 * THE ADDRESS IS THE JOB. This used to render a search box, then a 256px map,
 * then -- below the fold on a phone -- the address field that actually gets
 * stored. Two text inputs with a map wedged between them, and the one that
 * matters came last. A shop owner knows where their customer lives; making them
 * hunt for a rooftop first was ceremony in front of the real work.
 *
 * So there is now ONE input. It is the stored address, and it offers geocoded
 * suggestions as you type; picking one sets the pin as a side effect. The map
 * is collapsed behind a toggle for the cases that need it -- a place OSM does
 * not know, or a pin worth nudging.
 *
 * THE PIN IS STILL REQUIRED, and not merely because `orders.dropoff_lat/lng`
 * are NOT NULL behind a geofence CHECK. It becomes the rider's `geo:` link and
 * their Google Maps directions (app/rider/jobs/[id]), so it is the thing that
 * physically moves someone across Yangon. That is why a typed address never
 * silently invents one: a wrong pin sends a rider to the wrong street while the
 * screen says the right one. Picking a suggestion is explicit, one tap, and
 * accurate -- which is what makes the map optional rather than absent.
 *
 * Reverse geocoding is debounced to 800 ms and every lookup carries an
 * AbortSignal, because Nominatim's usage policy allows ~1 request/second. A
 * dragging pin would otherwise fire dozens of requests and get the IP blocked.
 *
 * The typed address stays authoritative: geocoded text is a *suggestion*.
 * Nominatim's Yangon coverage is patchy and a shop knows its own street better
 * than OSM does, so we never overwrite what the user typed.
 */

/** Search fires no faster than this. See the note on Nominatim's rate cap. */
const SEARCH_DEBOUNCE_MS = 600

/** Street level. Close enough to see which building the pin landed on. */
const RESULT_ZOOM = 17

export type LocationPickerProps = {
  kind: 'pickup' | 'dropoff'
  label: string
  point: LatLng | null
  address: string
  onPointChange: (point: LatLng) => void
  onAddressChange: (address: string) => void
  /**
   * Form field prefix. Emits `${fieldPrefix}Address`, `${fieldPrefix}Lat` and
   * `${fieldPrefix}Lng` so the server action reads one consistent naming scheme
   * and the parent never has to mirror the value into its own hidden input.
   */
  fieldPrefix: string
  addressError?: string
  pointError?: string
  addressPlaceholder?: string
  className?: string
}

export function LocationPicker({
  kind,
  label,
  point,
  address,
  onPointChange,
  onAddressChange,
  fieldPrefix,
  addressError,
  pointError,
  addressPlaceholder,
  className,
}: LocationPickerProps) {
  const defaults = mapDefaults()
  const [geocoding, setGeocoding] = useState(false)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)
  const [focus, setFocus] = useState<MapFocus | undefined>(undefined)
  /** Collapsed by default: the address is the job, the map is the exception. */
  const [mapOpen, setMapOpen] = useState(false)

  // The user has typed something they care about; stop suggesting over it.
  const addressTouched = useRef(address.trim().length > 0)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flightRef = useRef(0)

  /**
   * Set to a point's key just before it is handed up, when the label is already
   * known and better than anything reverse geocoding would return. Stops the
   * search result the shop just chose being second-guessed by a round trip.
   */
  const skipReverseRef = useRef<string | null>(null)

  /**
   * The map's initial view, captured once.
   *
   * Deliberately NOT `point`: making the viewport track the pin means dragging
   * the pin yanks the map out from under the finger doing the dragging, and it
   * would fight the flight animation below. Deliberate movements -- a search
   * result, "use my location" -- fly explicitly instead.
   */
  const [initialCenter] = useState<LatLng>(() => point ?? defaults.center)

  const outsideArea = point ? !isInServiceArea(point) : false

  const flyTo = useCallback((target: LatLng, zoom?: number) => {
    flightRef.current += 1
    setFocus({ point: target, zoom, nonce: flightRef.current })
  }, [])

  useEffect(() => {
    if (!point) return

    const key = `${point.lat},${point.lng}`
    if (skipReverseRef.current === key) {
      skipReverseRef.current = null
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    abortRef.current?.abort()

    const controller = new AbortController()
    abortRef.current = controller

    timerRef.current = setTimeout(async () => {
      setGeocoding(true)
      const result = await reverseGeocode(point.lat, point.lng, controller.signal)
      setGeocoding(false)
      if (controller.signal.aborted || !result) return

      if (addressTouched.current) {
        setSuggestion(result.label)
      } else {
        onAddressChange(result.label)
      }
    }, 800)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      controller.abort()
    }
    // onAddressChange is intentionally omitted: parent forms recreate it every
    // render, and including it would restart the debounce on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point?.lat, point?.lng])

  const handleSelectCandidate = useCallback(
    (candidate: GeocodeCandidate) => {
      skipReverseRef.current = `${candidate.point.lat},${candidate.point.lng}`
      addressTouched.current = true
      setSuggestion(null)
      onAddressChange(candidate.label)
      onPointChange(candidate.point)
      flyTo(candidate.point, RESULT_ZOOM)
    },
    [flyTo, onAddressChange, onPointChange],
  )

  const handleUseMyLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocateError('This device cannot share its location.')
      return
    }
    setLocating(true)
    setLocateError(null)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false)
        const here = { lat: coords.latitude, lng: coords.longitude }
        onPointChange(here)
        flyTo(here, RESULT_ZOOM)
      },
      (err) => {
        setLocating(false)
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Drag the pin instead.'
            : 'Could not get your location. Drag the pin instead.',
        )
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }, [flyTo, onPointChange])

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <MapPin className={cn('size-4', kind === 'pickup' ? 'text-brand-red' : 'text-brand-gold')} />
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleUseMyLocation}
          disabled={locating}
        >
          <LocateFixed />
          {locating ? 'Locating…' : 'Use my location'}
        </Button>
      </div>

      {/* The one input: what gets stored, and what finds the pin. */}
      <AddressField
        fieldPrefix={fieldPrefix}
        address={address}
        placeholder={addressPlaceholder}
        invalid={!!addressError}
        onAddressChange={(value) => {
          addressTouched.current = true
          onAddressChange(value)
        }}
        onSelect={handleSelectCandidate}
      />

      {/* The point travels as hidden fields so the form posts without JS-built payloads. */}
      <input type="hidden" name={`${fieldPrefix}Lat`} value={point?.lat ?? ''} />
      <input type="hidden" name={`${fieldPrefix}Lng`} value={point?.lng ?? ''} />

      {/*
        One line about the pin, and a way in. The map used to be 256px of always-
        on chrome; most bookings never need to open it now, because choosing a
        suggestion above has already set the point.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {point ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Crosshair className="size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
            <span className="tabular-nums">
              {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
            </span>
            {geocoding ? <span>· looking up address…</span> : null}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-medium text-amber-700">
            <Crosshair className="size-3.5 shrink-0" aria-hidden="true" />
            Pick a suggestion above to set the map pin
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setMapOpen((v) => !v)}
          aria-expanded={mapOpen}
        >
          {mapOpen ? 'Hide map' : point ? 'Check on map' : 'Set it on the map'}
        </Button>
      </div>

      {mapOpen ? (
        <div className="relative h-56 overflow-hidden rounded-md border sm:h-64">
          <MapCanvas
            center={initialCenter}
            focus={focus}
            markers={
              point
                ? [
                    {
                      id: kind,
                      point,
                      kind,
                      draggable: true,
                      onDragEnd: onPointChange,
                      label,
                    },
                  ]
                : []
            }
            onMapClick={onPointChange}
          />
          {!point ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
              <span className="flex items-center gap-2 rounded-md bg-background px-3 py-2 text-xs font-medium shadow">
                <Crosshair className="size-3.5" />
                Tap the map to drop the pin
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {suggestion && suggestion !== address ? (
        <button
          type="button"
          onClick={() => {
            onAddressChange(suggestion)
            setSuggestion(null)
          }}
          className="text-left text-[11px] text-primary hover:underline"
        >
          Use suggested address: {suggestion}
        </button>
      ) : null}

      {outsideArea ? (
        <Alert tone="error">
          That pin is outside our delivery area (Greater Yangon). Move it closer in.
        </Alert>
      ) : null}
      {pointError && !outsideArea ? <Alert tone="error">{pointError}</Alert> : null}
      {addressError ? <p className="text-xs font-medium text-destructive">{addressError}</p> : null}
      {locateError ? <p className="text-xs text-muted-foreground">{locateError}</p> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * The delivery address, which is also the search box.
 *
 * ONE INPUT, not two. It used to be a throwaway `query` above the map and a
 * separate stored-address field below it, so a shop typed the address twice --
 * once to find the place, once to record it -- and the second one was the only
 * one that reached the database. Here the value IS `${fieldPrefix}Address`:
 * typing searches, and choosing a result fills the pin behind the scenes.
 *
 * Typing without choosing is fine and stays exactly as typed. That is the
 * point: a shop that knows the address should never be blocked by OSM not
 * knowing it. They only need the map when no suggestion fits.
 *
 * Follows the ARIA combobox pattern rather than a plain input plus a div: the
 * listbox has to be reachable by keyboard, and a shop owner tabbing through the
 * order form must not fall into an invisible trap.
 *
 * Results outside the hard geofence are shown but NOT selectable. They come
 * back because the search is padded wider than `in_service_area()`, and the
 * database would refuse to store them -- so offering the choice would be a dead
 * end. Saying "found it, but out of area" is more useful than an empty list.
 */
function AddressField({
  fieldPrefix,
  address,
  placeholder,
  invalid,
  onAddressChange,
  onSelect,
}: {
  fieldPrefix: string
  address: string
  placeholder?: string
  invalid: boolean
  onAddressChange: (value: string) => void
  onSelect: (candidate: GeocodeCandidate) => void
}) {
  const listboxId = useId()
  const query = address
  const [results, setResults] = useState<GeocodeCandidate[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [active, setActive] = useState(-1)

  const rootRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * The last value the USER typed here.
   *
   * Now that this input is the stored address rather than a throwaway search
   * box, other things write to it: `applyCustomer` fills it from a past parcel,
   * reverse geocoding fills it from a dropped pin, and `choose` fills it from
   * the suggestion just accepted. Searching on any change would pop the listbox
   * open over a form nobody asked to search -- and in the `choose` case, search
   * for the label it had just accepted.
   *
   * A ref rather than a flag because a flag cannot tell WHICH change it is
   * guarding: set once by typing, it would still be set when a programmatic
   * write arrives later. Comparing the value identifies the source exactly.
   */
  const lastTypedRef = useRef<string | null>(null)

  const short = query.trim().length < MIN_QUERY_LENGTH

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    abortRef.current?.abort()

    // Written by something other than the keyboard: keep it, do not search it.
    if (query !== lastTypedRef.current) {
      setResults([])
      setSearched(false)
      setLoading(false)
      setOpen(false)
      return
    }

    if (short) {
      setResults([])
      setSearched(false)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)

    timerRef.current = setTimeout(async () => {
      const found = await forwardGeocode(query, controller.signal)
      if (controller.signal.aborted) return
      setResults(found)
      setSearched(true)
      setLoading(false)
      setActive(found.findIndex((c) => c.inServiceArea))
      setOpen(true)
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      controller.abort()
    }
  }, [query, short])

  // Clicking anywhere else dismisses the list. `pointerdown` rather than
  // `click` so the list is gone before a click lands on what is underneath.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const showList = open && !short && (results.length > 0 || (searched && !loading))

  function move(delta: number) {
    if (results.length === 0) return
    // Every result out of area: leave the highlight off entirely rather than
    // marking a row aria-selected that Enter will refuse.
    if (!results.some((r) => r.inServiceArea)) return
    setOpen(true)
    // Skip over out-of-area rows: they cannot be chosen, so stopping on them
    // would strand the keyboard.
    let next = active
    for (let i = 0; i < results.length; i += 1) {
      next = (next + delta + results.length) % results.length
      if (results[next]?.inServiceArea) break
    }
    setActive(next)
  }

  function choose(candidate: GeocodeCandidate) {
    if (!candidate.inServiceArea) return
    // `onSelect` writes the candidate's label into `address`, which is this
    // input's value -- so the field keeps the chosen address rather than being
    // emptied the way a throwaway search box was.
    onSelect(candidate)
    setOpen(false)
    setResults([])
    setSearched(false)
    // `lastTypedRef` still holds what the user typed, so the incoming label
    // will not match it and the effect above will leave it alone.
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={`${fieldPrefix}Address`}
          name={`${fieldPrefix}Address`}
          type="text"
          value={address}
          onChange={(e) => {
            lastTypedRef.current = e.target.value
            onAddressChange(e.target.value)
          }}
          onFocus={() => {
            if (results.length > 0) setOpen(true)
          }}
          onKeyDown={(e) => {
            // This input lives inside the order form. Enter must choose a
            // suggestion or do nothing -- never submit a half-filled order.
            if (e.key === 'Enter') {
              e.preventDefault()
              const candidate = results[active]
              if (showList && candidate) choose(candidate)
              return
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              move(1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              move(-1)
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          placeholder={placeholder ?? 'Street, ward, landmark…'}
          className="pl-9 pr-9"
          aria-invalid={invalid}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && active >= 0 ? `${listboxId}-opt-${active}` : undefined
          }
          autoComplete="off"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              lastTypedRef.current = ''
              onAddressChange('')
              setOpen(false)
            }}
            aria-label="Clear the address"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {loading && !short ? (
        <p className="mt-1 text-[11px] text-muted-foreground">Searching…</p>
      ) : null}

      {showList ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Address suggestions"
          /* Above Leaflet's own controls, which sit at z-index 1000. At equal
             z-index the map would win on DOM order and the zoom buttons would
             punch through the list. */
          className="absolute z-[1200] mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-background shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">
              Nothing found in the delivery area. Try a landmark or road name, or tap the map.
            </li>
          ) : (
            results.map((c, i) => (
              <li
                key={c.id}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                aria-disabled={!c.inServiceArea}
                onPointerDown={(e) => {
                  // Keep focus in the input so the blur handler does not close
                  // the list before the click resolves.
                  e.preventDefault()
                  choose(c)
                }}
                onMouseEnter={() => c.inServiceArea && setActive(i)}
                className={cn(
                  'border-b px-3 py-2 text-sm last:border-b-0',
                  c.inServiceArea
                    ? 'cursor-pointer'
                    : 'cursor-not-allowed bg-muted/40 text-muted-foreground',
                  i === active && c.inServiceArea && 'bg-muted',
                )}
              >
                <p className="font-medium">{c.name}</p>
                {c.detail ? (
                  <p className="truncate text-xs text-muted-foreground">{c.detail}</p>
                ) : null}
                {!c.inServiceArea ? (
                  <p className="text-xs font-medium text-destructive">Outside the delivery area</p>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
