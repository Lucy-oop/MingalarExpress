'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertRole } from '@/lib/auth/guards'
import { explainTripError, validateOverrideReason } from '@/lib/routes/errors'
import type { TripKind } from '@/lib/routes/ways'

/**
 * Dispatcher write actions for the route model.
 *
 * Every one is a thin wrapper over an 0008 RPC that does the real enforcement:
 * the ceilings, the lock discipline, the 20-parcel gate and the pay snapshot all
 * live in SQL. Nothing here re-implements a rule — it maps a SQLSTATE to a
 * sentence and refreshes the board.
 *
 * There used to be one piece of real logic here — `departTrip`'s two-phase call,
 * which caught `trip_below_minimum` and told the UI to open a modal asking for a
 * typed reason. 0039 made that reason optional, so the second phase and the
 * modal are gone and this file is once again nothing but RPC calls and error
 * mapping.
 */

export type TripResult =
  | { ok: true; message: string; tripId?: string }
  | { ok: false; message: string; retry: boolean }

function refresh() {
  revalidatePath('/admin')
  revalidatePath('/admin/super')
}

async function dispatchClient() {
  await assertRole('super_admin')
  return createClient()
}

const DENIED: TripResult = {
  ok: false,
  message: 'You do not have permission to do that.',
  retry: false,
}

/**
 * Record the way a parcel is going out on, once the office has chosen it.
 *
 * `orders.route_id` used to be written at booking from the area's default
 * route; since 0049 nothing assigns a way automatically, so this is where it
 * gets its value -- the way of the delivery run the parcel was loaded onto.
 * Pickup legs do not write it: the run that collects a parcel says nothing
 * about where it will be delivered.
 *
 * Best effort. The load has already succeeded, and a failure here only means
 * the order list shows no way for this parcel.
 */
async function recordWay(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tripId: string,
  orderIds: string[],
  leg: 'delivery' | 'pickup' | 'return',
) {
  if (leg !== 'delivery' || orderIds.length === 0) return
  const { data: trip } = await supabase.from('trips').select('route_id').eq('id', tripId).maybeSingle()
  if (!trip?.route_id) return
  await supabase.from('orders').update({ route_id: trip.route_id }).in('id', orderIds)
}

function fail(raw: string | null | undefined): TripResult {
  const { message, retry } = explainTripError(raw)
  refresh()
  return { ok: false, message, retry }
}

/**
 * A new, empty run on a way the office chose.
 *
 * `kind` is optional and informational (trips.kind, 0049): written straight
 * onto the row rather than through `plan_trip`, so the RPC's signature stays
 * what 0008 defined. The board no longer places runs by it.
 */
export async function planTrip(
  routeId: string,
  serviceDate?: string,
  kind?: TripKind,
): Promise<TripResult> {
  let supabase
  try {
    supabase = await dispatchClient()
  } catch {
    return DENIED
  }

  const { data, error } = await supabase.rpc('plan_trip', {
    p_route_id: routeId,
    p_service_date: serviceDate,
  })
  if (error) return fail(error.message)

  const trip = data as unknown as { id?: string } | null
  if (trip?.id && kind) await supabase.from('trips').update({ kind }).eq('id', trip.id)

  refresh()
  return { ok: true, message: 'Run created.', tripId: trip?.id }
}

export async function assignTripRider(tripId: string, riderId: string): Promise<TripResult> {
  let supabase
  try {
    supabase = await dispatchClient()
  } catch {
    return DENIED
  }

  const { error } = await supabase.rpc('assign_trip_rider', {
    p_trip_id: tripId,
    p_rider_id: riderId,
  })
  if (error) return fail(error.message)

  refresh()
  return { ok: true, message: 'Rider assigned to the run.' }
}

export async function loadTrip(
  tripId: string,
  orderIds: string[],
  leg: 'delivery' | 'pickup' | 'return' = 'delivery',
): Promise<TripResult> {
  let supabase
  try {
    supabase = await dispatchClient()
  } catch {
    return DENIED
  }
  if (orderIds.length === 0) {
    return { ok: false, message: 'Select at least one parcel to load.', retry: false }
  }

  const { error } = await supabase.rpc('load_trip', {
    p_trip_id: tripId,
    p_order_ids: orderIds,
    p_leg: leg,
  })
  if (error) return fail(error.message)
  await recordWay(supabase, tripId, orderIds, leg)

  refresh()
  const n = orderIds.length
  const noun = leg === 'pickup' ? 'pickup' : leg === 'return' ? 'return' : 'parcel'
  return { ok: true, message: `${n} ${noun}${n === 1 ? '' : 's'} loaded.` }
}

export async function unloadTrip(tripId: string, orderIds: string[]): Promise<TripResult> {
  let supabase
  try {
    supabase = await dispatchClient()
  } catch {
    return DENIED
  }
  if (orderIds.length === 0) {
    return { ok: false, message: 'Select at least one parcel to unload.', retry: false }
  }

  const { error } = await supabase.rpc('unload_trip', {
    p_trip_id: tripId,
    p_order_ids: orderIds,
  })
  if (error) return fail(error.message)

  refresh()
  return { ok: true, message: 'Parcels returned to the unrouted pool.' }
}

/**
 * Send a run out.
 *
 * ONE CALL NOW. This used to fire twice in the under-minimum case: the first
 * with no reason, which SQL refused with `trip_below_minimum`, returning
 * `requiresOverride` to open a modal, and the second carrying the typed reason.
 *
 * 0039 made the reason optional. The margin guard is worth SEEING — the volume
 * banner still reads off `min_parcels_per_trip` — but not worth a written
 * justification addressed to the person who already decided, and at this
 * volume it fired on nearly every run. The audit row still records every short
 * departure with the shortfall and the money, so the trail survives the typing.
 *
 * `overrideReason` is kept in the signature: SQL still stores one when given,
 * and still refuses one under ten characters. Nothing in the UI passes it
 * today.
 */
export async function departTrip(tripId: string, overrideReason?: string): Promise<TripResult> {
  let supabase
  try {
    supabase = await dispatchClient()
  } catch {
    return DENIED
  }

  const reason = overrideReason?.trim() || undefined

  // Still validated here as well as in SQL, for the caller that does supply
  // one: a character count is better returned instantly than after a round
  // trip. SQL remains the authority.
  if (reason !== undefined) {
    const problem = validateOverrideReason(reason)
    if (problem) return { ok: false, message: problem, retry: false }
  }

  const { error } = await supabase.rpc('depart_trip', {
    p_trip_id: tripId,
    p_override_reason: reason,
  })
  if (error) return fail(error.message)

  refresh()
  return {
    ok: true,
    message: reason
      ? 'Run dispatched under minimum volume. The override is on the audit log.'
      : 'Run dispatched.',
  }
}

/**
 * The parcels came off the bike.
 *
 * Shelves every collected pickup on the run so the office can sort it onto
 * delivery ways, WITHOUT closing the run or booking the rider's pay.
 *
 * WHY THIS IS A SEPARATE BUTTON. Until 0040 a collected parcel kept its
 * `trip_id` until `close_trip` detached it, and every dispatchable pool filters
 * `trip_id is null` — so between the rider tapping "I have the parcel" and
 * somebody pressing "Close & pay", the parcel sat in the office and could be
 * moved by nobody. The afternoon sort was gated behind a payroll button.
 *
 * `receive_trip` banks the pickup count before detaching, so closing later
 * still pays the rider for the morning. That arithmetic is asserted in
 * `route_flow.sql` R9a by running the same collection twice, once received and
 * once not, and demanding the same ledger line.
 */
export async function receiveTrip(tripId: string): Promise<TripResult> {
  let supabase
  try {
    supabase = await dispatchClient()
  } catch {
    return DENIED
  }

  const { data, error } = await supabase.rpc('receive_trip', { p_trip_id: tripId })
  if (error) return fail(error.message)

  refresh()
  const shelved = (data as unknown as { pickup_count?: number } | null)?.pickup_count ?? 0
  return {
    ok: true,
    message: `On the shelf. ${shelved} ${shelved === 1 ? 'parcel is' : 'parcels are'} ready to sort.`,
  }
}

/**
 * Receive only the parcels the office ticked off the bike (0049).
 *
 * `receiveTrip` above shelves everything collected on the run; this is the
 * checklist version. Unticked parcels stay on the run, still `picked_up`, so a
 * parcel the rider says they have but nobody has seen is not silently shelved.
 * All or nothing over the ticked ids -- see `receive_trip_parcels`.
 */
export async function receiveTripParcels(tripId: string, orderIds: string[]): Promise<TripResult> {
  let supabase
  try {
    supabase = await dispatchClient()
  } catch {
    return DENIED
  }

  if (orderIds.length === 0) {
    return { ok: false, message: 'Tick the parcels that came off the bike.', retry: false }
  }

  const { data, error } = await supabase.rpc('receive_trip_parcels', {
    p_trip_id: tripId,
    p_order_ids: orderIds,
  })
  if (error) return fail(error.message)

  refresh()
  const n = typeof data === 'number' ? data : orderIds.length
  return {
    ok: true,
    message: `${n} ${n === 1 ? 'parcel is' : 'parcels are'} in the hub and ready for a delivery way.`,
  }
}

export async function returnTrip(tripId: string): Promise<TripResult> {
  let supabase
  try {
    supabase = await dispatchClient()
  } catch {
    return DENIED
  }

  const { error } = await supabase.rpc('return_trip', { p_trip_id: tripId })
  if (error) return fail(error.message)

  refresh()
  return { ok: true, message: 'Run marked back at the hub.' }
}

/**
 * Close a run and book the rider's pay.
 *
 * Terminal and irreversible: `cod_ledger` is append-only, so a correction is a
 * new adjustment line, never a re-close. The UI confirms before calling this.
 */
export async function closeTrip(tripId: string): Promise<TripResult> {
  let supabase
  try {
    supabase = await dispatchClient()
  } catch {
    return DENIED
  }

  const { data, error } = await supabase.rpc('close_trip', { p_trip_id: tripId })
  if (error) return fail(error.message)

  refresh()
  const trip = data as unknown as { total_pay?: number } | null
  const pay = Number(trip?.total_pay ?? 0)
  return {
    ok: true,
    message: `Run closed. ${pay.toLocaleString()} Ks booked to the rider.`,
  }
}

/**
 * Close a run and record the rider handing in all of its cash (0052).
 *
 * The office's model: a rider hands in 100% of the cash every run and is paid
 * monthly, so closing is the moment the cash comes back. `expectedCash` is the
 * figure the office confirmed on screen; `close_run_and_deposit` refuses if the
 * ledger now says anything else, and does the close and the deposit in one
 * transaction. The rider's pay is booked unsettled, for the monthly settlement.
 */
export async function closeRunWithDeposit(tripId: string, expectedCash: number): Promise<TripResult> {
  let supabase
  try {
    supabase = await dispatchClient()
  } catch {
    return DENIED
  }

  const { error } = await supabase.rpc('close_run_and_deposit', {
    p_trip_id: tripId,
    p_expected_cash: expectedCash,
  })
  if (error) return fail(error.message)

  refresh()
  revalidatePath('/admin/audit')
  return {
    ok: true,
    message:
      expectedCash > 0
        ? `Run closed. ${expectedCash.toLocaleString()} Ks recorded as handed in; the rider's pay is kept for the monthly settlement.`
        : "Run closed. No cash to hand in; the rider's pay is kept for the monthly settlement.",
  }
}

export async function cancelTrip(tripId: string, reason: string): Promise<TripResult> {
  let supabase
  try {
    supabase = await dispatchClient()
  } catch {
    return DENIED
  }
  if (!reason.trim()) {
    return { ok: false, message: 'A reason is required to cancel a run.', retry: false }
  }

  const { error } = await supabase.rpc('cancel_trip', {
    p_trip_id: tripId,
    p_reason: reason.trim(),
  })
  if (error) return fail(error.message)

  refresh()
  return { ok: true, message: 'Run cancelled. Its parcels are back in the unrouted pool.' }
}

/**
 * Give these parcels to this rider. One action, whatever state the rider is in.
 *
 * WHAT IT REPLACES. Sending one parcel took four clicks to assign and three
 * more to dispatch: New run → tick → Load → rider chip → Depart → type ten
 * characters → Dispatch anyway. Every one of those is a decision the board
 * could already have made, and the operator had to make them in the right
 * order or meet a blocker that only appeared after the wrong one.
 *
 * IT COMPOSES, IT DOES NOT REIMPLEMENT. Three RPCs that already exist, in the
 * order the board walked by hand:
 *
 *   1. the rider's open run, if they have one
 *   2. `plan_trip(route, today, rider)` if they do not -- note the third
 *      argument, which has been in the signature since 0008 and which the UI
 *      has never once passed
 *   3. `load_trip(trip, ids, leg)`, the leg derived by `loadPlan`
 *   4. `depart_trip(trip)` -- ONLY for a run created here
 *
 * Every rule still lives in SQL. If the selection is mixed, or over a ceiling,
 * or on the wrong side of the hub, `load_trip` refuses exactly as it does from
 * the board, and `explainTripError` turns that into the same sentence.
 *
 * THE RIDER BEING OUT IS THE INTERESTING CASE, and it is the reason this reads
 * as one action rather than a macro. A rider already on the road gets a
 * TOP-UP: their run is found in step 1, loaded in step 3, and step 4 is
 * skipped because the bike is already gone. Before 0039 that was impossible
 * twice over -- `trips_rider_open_uk` forbids a second run and `load_trip`
 * refused a departed one -- so the parcel waited for tomorrow while the person
 * who could have carried it rode past the door.
 *
 * NOT PARTIALLY ATOMIC, and the message says so. Each RPC is its own
 * transaction, so a failure at step 3 leaves a created run behind. That run is
 * empty, visible on the board, and cancellable -- which is a better outcome
 * than a stored procedure nobody can see into, and the same thing that would
 * have happened doing it by hand.
 */
export async function sendToRider(
  orderIds: string[],
  riderId: string,
  routeId: string,
  leg: 'delivery' | 'pickup' | 'return',
): Promise<TripResult> {
  let supabase
  try {
    supabase = await dispatchClient()
  } catch {
    return DENIED
  }

  if (orderIds.length === 0) {
    return { ok: false, message: 'Tick some parcels first.', retry: false }
  }

  /*
    The rider's open run. Same three statuses as `trips_rider_open_uk`, which
    is what guarantees this returns at most one row -- so `maybeSingle` is a
    statement about the schema, not optimism.
  */
  const { data: open, error: lookupError } = await supabase
    .from('trips')
    .select('id, status, route_id')
    .eq('rider_id', riderId)
    .in('status', ['planned', 'loading', 'departed'])
    .maybeSingle()
  if (lookupError) return fail(lookupError.message)

  let tripId = open?.id as string | undefined
  const joinedExisting = tripId !== undefined

  if (!tripId) {
    const { data, error } = await supabase.rpc('plan_trip', {
      p_route_id: routeId,
      p_rider_id: riderId,
    })
    if (error) return fail(error.message)
    tripId = (data as unknown as { id?: string } | null)?.id
    if (!tripId) return fail('plan_trip returned no run')
    // A return rides out to a shop, so it is delivery-side work.
    await supabase
      .from('trips')
      .update({ kind: leg === 'pickup' ? 'pickup' : 'delivery' })
      .eq('id', tripId)
  }

  const { error: loadError } = await supabase.rpc('load_trip', {
    p_trip_id: tripId,
    p_order_ids: orderIds,
    p_leg: leg,
  })
  if (loadError) return fail(loadError.message)
  await recordWay(supabase, tripId, orderIds, leg)

  // A run that was already out stays out. Only one created here needs sending.
  if (!joinedExisting) {
    const { error: departError } = await supabase.rpc('depart_trip', { p_trip_id: tripId })
    if (departError) return fail(departError.message)
  }

  refresh()
  const n = orderIds.length
  const parcels = `${n} ${n === 1 ? 'parcel' : 'parcels'}`
  return {
    ok: true,
    message: joinedExisting
      ? `${parcels} added to the run already on the road.`
      : `${parcels} sent out.`,
    tripId,
  }
}

/**
 * Put the ticked parcels on a WAY the office chose (0049).
 *
 * The office decides the way; this finds that way's run and loads them onto
 * it, so they appear under the way on the left of the board. The run is:
 *
 *   1. an open run on that way today -- planned or loading, and for delivery
 *      work one that already HAS a rider (see below) -- oldest first
 *   2. otherwise the chosen rider's open run, if it is on this same way
 *   3. otherwise a new run on the way, with the chosen rider if one was given
 *
 * WHY DELIVERIES NEED A RIDER. Loading a hub-held parcel marks it `assigned`
 * to the run's rider, and `orders_assigned_needs_rider` refuses a rider-less
 * assignment -- the same rule the load button enforces as held_needs_rider.
 * A collection can wait on a rider-less run; a delivery cannot.
 *
 * Composes existing RPCs, like `sendToRider`, and is not atomic across them:
 * a failure after step 3 leaves an empty, visible, cancellable run.
 */
export async function assignToWay(
  orderIds: string[],
  routeId: string,
  leg: 'delivery' | 'pickup' | 'return',
  serviceDate: string,
  riderId?: string,
): Promise<TripResult> {
  let supabase
  try {
    supabase = await dispatchClient()
  } catch {
    return DENIED
  }
  if (orderIds.length === 0) {
    return { ok: false, message: 'Tick some parcels first.', retry: false }
  }
  if (!routeId) return { ok: false, message: 'Choose a way.', retry: false }

  const needsRider = leg !== 'pickup'

  // 1. An open run already on this way.
  let query = supabase
    .from('trips')
    .select('id, rider_id')
    .eq('route_id', routeId)
    .eq('service_date', serviceDate)
    .in('status', ['planned', 'loading'])
    .order('created_at', { ascending: true })
    .limit(1)
  if (needsRider) query = query.not('rider_id', 'is', null)
  if (riderId) query = query.eq('rider_id', riderId)
  const { data: runs, error: runError } = await query
  if (runError) return fail(runError.message)
  let tripId: string | undefined = runs?.[0]?.id

  if (!tripId && riderId) {
    // 2. The rider may already be out on this way (one open run per rider).
    const { data: open } = await supabase
      .from('trips')
      .select('id, route_id')
      .eq('rider_id', riderId)
      .in('status', ['planned', 'loading', 'departed'])
      .maybeSingle()
    if (open && open.route_id !== routeId) {
      return {
        ok: false,
        message: 'That rider is already on a run on another way. Choose another rider.',
        retry: false,
      }
    }
    tripId = open?.id
  }

  if (!tripId) {
    if (needsRider && !riderId) {
      return {
        ok: false,
        message:
          'This way has no run with a rider yet. Choose a rider to go with it — parcels in the hub go out with a rider.',
        retry: false,
      }
    }
    // 3. A new run on the way.
    const { data, error } = await supabase.rpc('plan_trip', {
      p_route_id: routeId,
      p_service_date: serviceDate,
      ...(riderId ? { p_rider_id: riderId } : {}),
    })
    if (error) return fail(error.message)
    tripId = (data as unknown as { id?: string } | null)?.id
    if (!tripId) return fail('plan_trip returned no run')
    await supabase
      .from('trips')
      .update({ kind: leg === 'pickup' ? 'pickup' : 'delivery' })
      .eq('id', tripId)
  }

  const { error: loadError } = await supabase.rpc('load_trip', {
    p_trip_id: tripId,
    p_order_ids: orderIds,
    p_leg: leg,
  })
  if (loadError) return fail(loadError.message)
  await recordWay(supabase, tripId, orderIds, leg)

  refresh()
  const n = orderIds.length
  return {
    ok: true,
    message: `${n} ${n === 1 ? 'parcel' : 'parcels'} put on the way.`,
    tripId,
  }
}
