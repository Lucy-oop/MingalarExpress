import { createClient } from '@/lib/supabase/server'

/**
 * A rider's runs, newest first — "way history".
 *
 * WHY NOT THE EARNINGS PAGE. `/rider/earnings` lists `cod_ledger` rows, which
 * is the right view of the MONEY: every line, filterable, reconcilable against
 * a settlement. But a `trip_pay` line reads "45,900" with no way to tell which
 * run earned it, how many parcels it was, or which route. A rider asking "what
 * did I do on Tuesday" cannot answer it from a ledger. This groups by the run.
 *
 * ===========================================================================
 * THE THREE THINGS THAT MADE THIS SCREEN READ 0 · 0 · 0 Ks
 * ===========================================================================
 *
 * All three are the same shape of mistake: reading a column that the run's own
 * lifecycle has since cleared, and reporting the absence as a zero.
 *
 * 1. `orders.trip_id` IS NOT A HISTORICAL LINK. `receive_trip` and `close_trip`
 *    both null it on collections (`receive_trip:148`, `close_trip:302`) because
 *    every dispatchable pool on the board filters `trip_id is null` — a parcel
 *    on the hub shelf must look unattached. The old query counted collections
 *    with `orders.trip_id = trip.id`, so the moment the office received a run,
 *    that morning's eight collections became zero. Permanently.
 *
 *    A DELIVERY-leg parcel that reached the customer is never detached (only
 *    failed ones and pickups are), so `delivered` CAN still be counted live and
 *    is. The asymmetry is the whole trick here, and it is why the two counts
 *    come from two different places.
 *
 * 2. `trips.total_pay` IS ZERO ON A `per_parcel` ROUTE, and always will be.
 *    `close_trip` books its single `trip_pay` line only on a 'trip' route; on
 *    per_parcel the parcels pay themselves as they are worked (0042). The old
 *    query read `total_pay` alone, so every per_parcel run showed 0 Ks no
 *    matter how much the rider had actually earned.
 *
 *    `cod_ledger` is the book of record and every pay line carries `trip_id` —
 *    `trip_pay` from close, and `commission_earned` / `pickup_pay` stamped by
 *    the audit trigger (0042:391, :430). Summing the ledger by trip is correct
 *    under BOTH pay models, and it accrues live: a rider on a per_parcel route
 *    watches the figure move as they deliver.
 *
 * 3. ONLY CLOSED RUNS WERE LISTED. `status in ('closed','returned')` hid the
 *    run the rider is on right now, which is the one they are most likely to
 *    open the screen to look at.
 *
 * `collected` therefore comes from `trips.pickup_count` — banked by
 * `receive_trip` on its way past and re-banked as the total by `close_trip`
 * (0040) — plus anything still attached on a run not yet received. The two can
 * never double-count, because detaching and banking happen in the same
 * statement.
 */
export type WayParcel = {
  /** Order id where we still have it; the ledger line's id otherwise. */
  key: string
  code: string
  /**
   * WHO IT WAS FOR — the shop on a collection, the customer on a delivery —
   * with the township where there is one. A rider recognises "Lady Fashion ·
   * Kamayut" instantly and a tracking code never; the code is for reading OUT
   * to the office, not for finding your place in a list.
   */
  name: string | null
  area: string | null
  kind: 'delivered' | 'collected'
  /** What this parcel paid the rider, 0 on a 'trip' route where pay is per run. */
  pay: number
}

export type RiderWay = {
  id: string
  /** ISO. Closed, else departed, else the service date. */
  at: string
  routeCode: string
  routeName: string
  colour: string
  /** So the card can say "on the road" rather than implying the run is done. */
  status: string
  /** Parcels handed to a customer on this run. */
  delivered: number
  /** Parcels collected from a shop on this run. */
  collected: number
  /** Parcels that came back or could not be handed over. */
  unresolved: number
  /** Ledger `commission_earned` for this run. */
  deliveryPay: number
  /** Ledger `pickup_pay` for this run. */
  pickupPay: number
  /** Ledger `trip_pay` — the whole fee on a 'trip' route, 0 on per_parcel. */
  tripPay: number
  /** Everything the run paid, whichever model it was on. */
  pay: number
  /** Itemised, for the expandable list. Newest first. */
  parcels: WayParcel[]
  /**
   * Collections this run is credited with that NOTHING can still name.
   *
   * `receive_trip` detaches a collected parcel and banks only a COUNT, so a run
   * received before 0042 existed — before any `pickup_pay` line was written —
   * leaves no per-parcel trace at all: no trip link, no ledger row. The count
   * is real and the itemisation is genuinely gone.
   *
   * Saying "8 parcels handed in at hub" is the honest rendering of that.
   * "No parcels recorded against this run" was not: it contradicted the 8 in
   * the summary line directly above it.
   */
  shelved: number
}

/** Pay lines only. `cod_collected` is the customer's cash, not the rider's. */
const PAY_KINDS = ['trip_pay', 'commission_earned', 'pickup_pay'] as const

export async function getRiderWays(limit = 40): Promise<RiderWay[]> {
  const supabase = await createClient()

  /*
    A run the rider has actually ridden. `planned` and `loading` are the
    office's staging states — nothing has happened on them yet — and
    `cancelled` never left the hub. Everything else is history or in progress.
  */
  const { data: trips, error } = await supabase
    .from('trips')
    .select(
      'id, status, service_date, departed_at, closed_at, pickup_count, routes:route_id (code, name, colour)',
    )
    .in('status', ['departed', 'returned', 'closed'])
    .order('service_date', { ascending: false })
    .limit(limit)

  if (error || !trips || trips.length === 0) return []
  const ids = trips.map((t) => t.id)

  /*
    SCOPED TO THESE RUNS, not fetched whole. Both of these used to be unbounded
    selects over the rider's entire history, which PostgREST silently caps at
    1000 rows — so a busy rider's oldest runs would quietly start reading zero.
  */
  const { data: ledger } = await supabase
    .from('cod_ledger')
    .select('id, order_id, trip_id, kind, amount, memo, created_at')
    .in('trip_id', ids)
    .in('kind', PAY_KINDS)

  /*
    TWO WAYS TO REACH A PARCEL, AND BOTH ARE NEEDED.

    Still attached to the run -> `trip_id`. Detached by receive/close but named
    by a pay line -> that line's `order_id`. The ORDER ROW SURVIVES either way;
    it is only the trip link that is cleared, so once we have an id the
    customer, the shop and the township are all still there to read.
  */
  const fromLedger = [
    ...new Set((ledger ?? []).flatMap((l) => (l.order_id ? [l.order_id] : []))),
  ]
  const [{ data: attached }, { data: named }] = await Promise.all([
    supabase
      .from('orders')
      .select(
        'id, code, status, trip_id, trip_leg, customer_name, shops:shop_id (name), dropoff_area:dropoff_area_id (name)',
      )
      .in('trip_id', ids),
    fromLedger.length
      ? supabase
          .from('orders')
          .select(
            'id, code, status, trip_id, trip_leg, customer_name, shops:shop_id (name), dropoff_area:dropoff_area_id (name)',
          )
          .in('id', fromLedger)
      : Promise.resolve({ data: [] as never[] }),
  ])

  const orders = attached ?? []
  const byId = new Map<string, (typeof orders)[number]>()
  for (const o of [...(named ?? []), ...orders]) byId.set(o.id, o)

  const ways = trips.map((t) => {
    const route = t.routes as unknown as { code: string; name: string; colour: string } | null
    const mine = (orders ?? []).filter((o) => o.trip_id === t.id)
    const lines = (ledger ?? []).filter((l) => l.trip_id === t.id)

    // Ledger amounts are NEGATIVE — a pay line is money the platform owes the
    // rider (see `ledger_kind`). Flip once, here, so nothing downstream has to.
    /*
      `|| 0` because negating the sum of an EMPTY list gives JavaScript's
      negative zero, which Intl renders as the string "-0" — a run that earned
      nothing printed "-0 Ks". `formatMmk` now normalises it too (belt and
      braces, and that one protects every other money figure in the app), but
      the data leaving this function should be clean in the first place.
    */
    const sum = (kind: string) =>
      -lines.filter((l) => l.kind === kind).reduce((n, l) => n + Number(l.amount), 0) || 0

    const deliveryPay = sum('commission_earned')
    const pickupPay = sum('pickup_pay')
    const tripPay = sum('trip_pay')

    /*
      A delivery-leg parcel that reached the customer keeps its trip_id for
      good, so this stays correct long after the run is closed.
    */
    const delivered = mine.filter(
      (o) => o.trip_leg === 'delivery' && o.status === 'delivered',
    ).length

    /*
      Banked plus still-attached. `receive_trip` moves a collection from the
      second term to the first in one statement, so the total never moves and
      never double-counts.
    */
    const collected =
      Number(t.pickup_count ?? 0) +
      mine.filter(
        (o) => o.trip_leg === 'pickup' && (o.status === 'picked_up' || o.status === 'delivered'),
      ).length

    /*
      ITEMISED FROM WHATEVER STILL HOLDS THE LINK. A parcel keeps its row while
      it is attached; once detached, the ledger line it produced is the only
      thing that still names it, and `memo` is the parcel code (0042:395).
      Ledger first, so a detached collection is not lost, then anything attached
      the ledger has not already named.
    */
    /*
      The shop on a collection, the customer on a delivery. A pickup leg ends at
      our own hub, so "who" is the counter it came FROM; a delivery ends at a
      door, so it is the person who opened it.
    */
    const who = (id: string | null, kind: 'delivered' | 'collected') => {
      const o = id ? byId.get(id) : undefined
      if (!o) return { name: null, area: null }
      const shop = (o.shops as unknown as { name: string } | null)?.name ?? null
      const area = (o.dropoff_area as unknown as { name: string } | null)?.name ?? null
      return { name: kind === 'collected' ? shop : o.customer_name, area }
    }

    const seen = new Set<string>()
    const parcels: WayParcel[] = []
    for (const l of lines) {
      if (l.kind === 'trip_pay' || !l.order_id) continue
      seen.add(l.order_id)
      const kind = l.kind === 'pickup_pay' ? ('collected' as const) : ('delivered' as const)
      parcels.push({
        key: String(l.id),
        code: byId.get(l.order_id)?.code ?? l.memo ?? '—',
        ...who(l.order_id, kind),
        kind,
        pay: -Number(l.amount),
      })
    }
    for (const o of mine) {
      if (seen.has(o.id)) continue
      if (o.trip_leg === 'delivery' && o.status === 'delivered')
        parcels.push({ key: o.id, code: o.code, ...who(o.id, 'delivered'), kind: 'delivered', pay: 0 })
      else if (o.trip_leg === 'pickup' && (o.status === 'picked_up' || o.status === 'delivered'))
        parcels.push({ key: o.id, code: o.code, ...who(o.id, 'collected'), kind: 'collected', pay: 0 })
    }

    return {
      id: t.id,
      at: t.closed_at ?? t.departed_at ?? `${t.service_date}T00:00:00Z`,
      routeCode: route?.code ?? '—',
      routeName: route?.name ?? '—',
      colour: route?.colour ?? '#999999',
      status: t.status,
      delivered,
      collected,
      unresolved: mine.filter((o) => o.status === 'failed' || o.status === 'returned').length,
      deliveryPay,
      pickupPay,
      tripPay,
      pay: deliveryPay + pickupPay + tripPay,
      parcels,
      shelved: Math.max(0, collected - parcels.filter((p) => p.kind === 'collected').length),
    }
  })

  // `service_date` alone puts two runs on the same day in insertion order.
  return ways.sort((a, b) => b.at.localeCompare(a.at))
}
