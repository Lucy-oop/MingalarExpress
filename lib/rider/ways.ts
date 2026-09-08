import { createClient } from '@/lib/supabase/server'

/**
 * A rider's finished runs, newest first — "way history".
 *
 * WHY NOT THE EARNINGS PAGE. `/rider/earnings` already lists `cod_ledger` rows,
 * which is the right view of the MONEY: every line, filterable, reconcilable
 * against a settlement. But a `trip_pay` line reads "45,900" with no way to
 * tell which run earned it, how many parcels it was, or which route. A rider
 * asking "what did I do on Tuesday" cannot answer it from a ledger.
 *
 * So this groups by the run itself. The two views answer different questions
 * and neither replaces the other.
 *
 * NO NEW RPC. `trips` already carries `total_pay`, `closed_at` and `route_id`,
 * and `trips_read_rider` already scopes a rider to their own runs — pinned by
 * `route_flow` R8a, which asserts one rider cannot see another's. The counts
 * come from the parcels that were on each run.
 *
 * `trip_summary` exists and is deliberately NOT used: nothing calls it, and its
 * `projected_fees` still multiplies by `routes.per_parcel_fee`, which stopped
 * being the customer price at 0033. Reviving a stale function for a new screen
 * would spread the staleness.
 */
export type RiderWay = {
  id: string
  /** ISO. `closed_at` when the run finished; `service_date` is the fallback. */
  at: string
  routeCode: string
  routeName: string
  colour: string
  /** Parcels handed to a customer on this run. */
  delivered: number
  /** Parcels collected from a shop on this run. */
  collected: number
  /** Parcels that came back or could not be handed over. */
  unresolved: number
  /** `trips.total_pay`, snapshotted by `close_trip`. */
  pay: number
}

export async function getRiderWays(limit = 40): Promise<RiderWay[]> {
  const supabase = await createClient()

  const [{ data: trips, error }, { data: parcels }] = await Promise.all([
    supabase
      .from('trips')
      .select(
        'id, service_date, closed_at, total_pay, routes:route_id (code, name, colour)',
      )
      // A run still out is not history. `returned` is included because the
      // parcels are back at the hub even if the paperwork is not closed, and a
      // rider who has finished driving expects to see it.
      .in('status', ['closed', 'returned'])
      .order('closed_at', { ascending: false, nullsFirst: false })
      .limit(limit),
    // Every parcel that touched one of this rider's runs. RLS scopes both
    // queries, so no rider filter is needed here either.
    supabase.from('orders').select('trip_id, status, trip_leg'),
  ])

  if (error || !trips) return []

  return trips.map((t) => {
    const mine = (parcels ?? []).filter((o) => o.trip_id === t.id)
    const route = t.routes as unknown as { code: string; name: string; colour: string } | null
    return {
      id: t.id,
      at: t.closed_at ?? `${t.service_date}T00:00:00Z`,
      routeCode: route?.code ?? '—',
      routeName: route?.name ?? '—',
      colour: route?.colour ?? '#999999',
      delivered: mine.filter((o) => o.status === 'delivered').length,
      /*
        A COLLECTION IS A PICKUP LEG, whatever it became afterwards. Counting
        `status = 'picked_up'` would miss every parcel that was collected on
        this run and delivered on a later one — which, since collect-before-
        deliver, is most of them.
      */
      collected: mine.filter((o) => o.trip_leg === 'pickup').length,
      unresolved: mine.filter((o) => o.status === 'failed' || o.status === 'returned').length,
      pay: Number(t.total_pay ?? 0),
    }
  })
}
