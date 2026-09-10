'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertRole } from '@/lib/auth/guards'
import { explainTripError, validateOverrideReason } from '@/lib/routes/errors'

/**
 * Dispatcher write actions for the route model.
 *
 * Every one is a thin wrapper over an 0008 RPC that does the real enforcement:
 * the ceilings, the lock discipline, the 20-parcel gate and the pay snapshot all
 * live in SQL. Nothing here re-implements a rule — it maps a SQLSTATE to a
 * sentence and refreshes the board.
 *
 * The one piece of real logic is `departTrip`'s two-phase call: try clean, and if
 * SQL says the run is short, tell the UI to ask for a reason rather than
 * reporting a failure. See `requiresOverride` below.
 */

export type TripResult =
  | { ok: true; message: string; tripId?: string }
  | { ok: false; message: string; retry: boolean; requiresOverride?: boolean }

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

function fail(raw: string | null | undefined): TripResult {
  const { message, retry, kind } = explainTripError(raw)
  refresh()
  return { ok: false, message, retry, requiresOverride: kind === 'below_minimum' }
}

export async function planTrip(routeId: string, serviceDate?: string): Promise<TripResult> {
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

  refresh()
  const trip = data as unknown as { id?: string } | null
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
 * Called twice in the under-minimum case, and that is deliberate. The first call
 * passes no reason; if the run is short, SQL refuses with `trip_below_minimum`
 * and this returns `requiresOverride`, which is what opens the modal. The second
 * call carries the reason.
 *
 * The alternative — deciding in the browser whether a run is short and skipping
 * straight to the modal — would put the threshold in two places. The board still
 * shows the banner from `min_parcels_per_trip` so a dispatcher is never
 * surprised, but the DECISION to demand a reason is made once, in SQL, by the
 * function that also writes the audit row.
 */
export async function departTrip(tripId: string, overrideReason?: string): Promise<TripResult> {
  let supabase
  try {
    supabase = await dispatchClient()
  } catch {
    return DENIED
  }

  const reason = overrideReason?.trim() || undefined

  // Validated here as well as in SQL so a dispatcher gets the character count
  // back instantly instead of after a round trip. SQL remains the authority.
  if (reason !== undefined) {
    const problem = validateOverrideReason(reason)
    if (problem) return { ok: false, message: problem, retry: false, requiresOverride: true }
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
