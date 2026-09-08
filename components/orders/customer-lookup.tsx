'use client'

import * as React from 'react'
import { Search, UserRound, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  dedupeCustomers,
  matchesTerm,
  MIN_LOOKUP_LENGTH,
  reuse,
  type PastOrderRow,
  type RecentCustomer,
  type ReusedCustomer,
} from '@/lib/orders/customer-lookup'
import { useT } from '@/components/shared/i18n-provider'
import { Input } from '@/components/ui/input'
import { formatMyanmarPhone } from '@/lib/utils'
import { cn } from '@/lib/utils'

/**
 * "Sent to them before?" — fills the whole customer half of the form in one tap.
 *
 * SCOPED BY RLS, NOT BY THIS QUERY. `orders_read_shop` is `owns_shop(shop_id)`,
 * so this reads only the shop's own parcels no matter what it asks for. There is
 * deliberately no `.eq('shop_id', …)` here: adding one would suggest the filter
 * is what protects the data, and the day someone removes it for a "small fix"
 * the policy is all that stands between one shop and another's customer list.
 *
 * A combobox in the same shape as the address search in `location-picker` —
 * a plain input plus a sibling listbox, keyboard-navigable, rather than a
 * headless-UI dependency. Same reason: this runs on cheap Android phones.
 *
 * Transient by design: the box clears itself on selection. It is a finder, not
 * a bound field, so it never posts anything.
 */

const DEBOUNCE_MS = 300
/** Enough history to dedupe from without pulling a shop's whole ledger. */
const FETCH_ROWS = 200

const COLUMNS =
  'customer_name, customer_phone, customer_phone_alt, dropoff_address, ' +
  'dropoff_area_id, dropoff_lat, dropoff_lng, dropoff_note, created_at'

export function CustomerLookup({ onPick }: { onPick: (customer: ReusedCustomer) => void }) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [rows, setRows] = React.useState<RecentCustomer[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(-1)

  const listboxId = React.useId()
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const short = query.trim().length < MIN_LOOKUP_LENGTH

  React.useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (short) {
      setRows(null)
      setLoading(false)
      return
    }

    setLoading(true)
    let cancelled = false

    timerRef.current = setTimeout(() => {
      void (async () => {
        const supabase = createClient()
        // Newest first, because dedupeCustomers keeps the first row it sees for
        // a phone and people move house.
        const { data, error } = await supabase
          .from('orders')
          .select(COLUMNS)
          .order('created_at', { ascending: false })
          .limit(FETCH_ROWS)

        if (cancelled) return
        setLoading(false)
        if (error) {
          setRows([])
          return
        }

        const all = (data ?? []) as unknown as PastOrderRow[]
        const found = dedupeCustomers(all.filter((r) => matchesTerm(r, query)))
        setRows(found)
        setActive(found.length > 0 ? 0 : -1)
        setOpen(true)
      })()
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query, short])

  const choose = (customer: RecentCustomer) => {
    onPick(reuse(customer))
    setQuery('')
    setRows(null)
    setOpen(false)
    setActive(-1)
  }

  const move = (delta: number) => {
    if (!rows?.length) return
    setActive((i) => {
      const next = i + delta
      if (next < 0) return rows.length - 1
      if (next >= rows.length) return 0
      return next
    })
  }

  const showList = open && !short && rows !== null

  /*
    CLOSE WHEN THE SHOP CLICKS ANYWHERE ELSE, and this was simply missing.

    The input deliberately has no `onBlur` -- the note below explains why -- but
    nothing ever replaced it, so `open` only cleared on Escape or on choosing a
    row. The list therefore stayed up, `absolute` over the fields beneath it,
    and the next thing the shop tried to click was behind a listbox. That is the
    "cannot click it smoothly" symptom; the z-index was never the problem
    (`z-1200` compiles, and Leaflet's panes top out below it).

    `pointerdown` rather than `click` so the list is gone before the click lands
    on whatever is underneath, and capture so a stopPropagation inside the form
    cannot swallow it.
  */
  const boxRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!showList) return
    const away = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [showList])

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={`${listboxId}-input`} className="sr-only">
        {t('book.findCustomer')}
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id={`${listboxId}-input`}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          showList && active >= 0 ? `${listboxId}-opt-${active}` : undefined
        }
        value={query}
        placeholder={t('book.findCustomer')}
        autoComplete="off"
        className="h-12 pl-9 text-base"
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        // NO onBlur, deliberately: a blur firing before the click on a row
        // would close the list and the click would land on whatever moved up
        // underneath. The outside-pointerdown effect above closes it instead,
        // and it checks containment, so a row click is safe. This handler only
        // needs the keyboard.
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            move(1)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            move(-1)
          } else if (e.key === 'Enter') {
            // Unconditional: this input lives inside the order form and Enter
            // must never submit a half-filled parcel.
            e.preventDefault()
            const picked = rows?.[active]
            if (picked) choose(picked)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />

      {query.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            setQuery('')
            setRows(null)
          }}
          aria-label={t('action.cancel')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground"
        >
          <X className="size-4" />
        </button>
      ) : null}

      {showList ? (
        <ul
          id={listboxId}
          role="listbox"
          // Above Leaflet's controls, which sit at z-1000 further down the form.
          className="absolute inset-x-0 top-full z-1200 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-background shadow-lg"
        >
          {loading ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">{t('book.searching')}</li>
          ) : rows.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">{t('book.noCustomer')}</li>
          ) : (
            rows.map((c, i) => (
              <li
                key={c.customer_phone}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                /*
                  ON CLICK, NOT ON POINTERDOWN. Choosing on pointerdown meant a
                  SCROLL GESTURE selected a customer: this list is
                  `max-h-72 overflow-y-auto`, so on a phone the finger that
                  starts a scroll starts it on a row, and the shop booked a
                  parcel for whoever they happened to touch first.

                  The `preventDefault` that came with it existed to beat an
                  `onBlur` on the input -- and there is no `onBlur`; the
                  outside-pointerdown handler above closes the list instead, and
                  it checks containment, so a click on a row survives it.
                */
                onClick={() => choose(c)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex cursor-pointer items-start gap-2 px-3 py-2.5 text-sm',
                  i === active && 'bg-muted',
                )}
              >
                <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{c.customer_name}</span>
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    {formatMyanmarPhone(c.customer_phone)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.dropoff_address}
                  </span>
                </span>
                {c.orderCount > 1 ? (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                    ×{c.orderCount}
                  </span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
