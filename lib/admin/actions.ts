'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PHONE_TAKEN_ADMIN, phoneTaken } from '@/lib/auth/phone'
import { assertRole } from '@/lib/auth/guards'
import { explainAdminError } from '@/lib/admin/errors'
import {
  riderCreateSchema,
  riderUpdateSchema,
  pricingSchema,
  areaSchema,
  zoneSchema,
  coverageSchema,
  adjustmentSchema,
} from '@/lib/validation/admin'

export type AdminResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> }

function refresh() {
  revalidatePath('/admin/super')
  revalidatePath('/admin/super/riders')
  revalidatePath('/admin/super/areas')
  revalidatePath('/admin/super/pricing')
  revalidatePath('/admin/super/settlements')
  revalidatePath('/admin/audit')
  revalidatePath('/admin/dispatcher')
}

async function admin() {
  await assertRole('super_admin')
  return createClient()
}

// ---------------------------------------------------------------------------
// Riders
// ---------------------------------------------------------------------------

/**
 * Register a rider.
 *
 * This is the ONE flow that needs the service-role key. `app_metadata.role` is
 * the only role source `tg_on_auth_user_created` trusts, and app_metadata is
 * writable exclusively through the Admin API — which is precisely what makes
 * public signup unable to mint a rider or a dispatcher.
 *
 * The profile and rider_profiles rows are created by the DB triggers, not here.
 */
export async function registerRider(
  _prev: AdminResult,
  formData: FormData,
): Promise<AdminResult> {
  try {
    await assertRole('super_admin')
  } catch {
    return { ok: false, message: 'Only a Super Admin can register riders.' }
  }

  const parsed = riderCreateSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    password: formData.get('password'),
    baseAreaId: formData.get('baseAreaId') || null,
    coverageKm: formData.get('coverageKm'),
    maxActiveOrders: formData.get('maxActiveOrders'),
    codFloatLimit: formData.get('codFloatLimit'),
    vehiclePlate: formData.get('vehiclePlate') || '',
    nrcNo: formData.get('nrcNo') || '',
    holdForApproval: formData.get('holdForApproval') === 'on',
  })
  if (!parsed.success) {
    return { ok: false, message: 'Check the fields below.', fieldErrors: parsed.error.flatten().fieldErrors }
  }
  const v = parsed.data

  let service
  try {
    service = createAdminClient()
  } catch {
    return {
      ok: false,
      message: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so accounts cannot be created.',
    }
  }

  /*
    THE NUMBER HAS TO BE FREE BEFORE GOTRUE IS ASKED TO CREATE THE USER.

    `profiles.phone` carries a partial UNIQUE index and the profile row is
    written by tg_on_auth_user_created INSIDE the auth.users insert, so a reused
    number raises 23505 and rolls the whole thing back. What comes back is
    "Database error creating new user" -- no code, no field, status 500 -- which
    is what an operator was being shown for the ordinary mistake of reusing a
    number. `myanmarPhone` has already normalised this to +959…, so it compares
    against what the trigger will store.
  */
  if (await phoneTaken(v.phone)) {
    return { ok: false, message: PHONE_TAKEN_ADMIN, fieldErrors: { phone: [PHONE_TAKEN_ADMIN] } }
  }

  const { data: created, error } = await service.auth.admin.createUser({
    email: v.email,
    password: v.password,
    email_confirm: true,
    app_metadata: { role: 'rider' },
    user_metadata: { full_name: v.fullName, phone: v.phone },
  })

  if (error || !created.user) {
    const message = error?.message ?? 'Could not create that account.'
    if (/already been registered|already exists/i.test(message)) {
      return { ok: false, message: 'An account with that email already exists.', fieldErrors: { email: ['Already registered'] } }
    }
    /*
      The check above is not a lock, so two admins can claim one number in the
      same instant. Asked again rather than matched on the message: the
      constraint name is in the Postgres error but NOT in what supabase-js
      returns -- verified against staging -- so there is nothing in the string
      to match on. If the number was free a moment ago and is taken now, that is
      the race, and saying so is better than "Database error creating new user".
    */
    if (await phoneTaken(v.phone)) {
      return { ok: false, message: PHONE_TAKEN_ADMIN, fieldErrors: { phone: [PHONE_TAKEN_ADMIN] } }
    }
    console.error(`[registerRider] unhandled auth error status=${(error as { status?: number })?.status ?? 0}: ${message}`)
    return { ok: false, message }
  }

  // The trigger has created profiles + rider_profiles; fill in the operating
  // parameters. Service-role, because these are the admin-only columns that
  // tg_riders_guard protects.
  const { error: profileError } = await service
    .from('rider_profiles')
    .update({
      base_area_id: v.baseAreaId,
      coverage_km: v.coverageKm,
      max_active_orders: v.maxActiveOrders,
      cod_float_limit: v.codFloatLimit,
      vehicle_plate: v.vehiclePlate || null,
      nrc_no: v.nrcNo || null,
    })
    .eq('id', created.user.id)

  if (profileError) {
    return {
      ok: false,
      message: `Account created, but the rider settings did not save: ${profileError.message}. Edit the rider to finish.`,
    }
  }

  // Park the account pending approval. Done as a second write rather than at
  // create time because the profiles row is authored by the signup trigger, and
  // is_active is the flag every layer already honours -- middleware, requireUser
  // and auth_role() -- so a held rider is genuinely inert, not merely hidden.
  if (v.holdForApproval) {
    const { error: holdError } = await service
      .from('profiles')
      .update({ is_active: false })
      .eq('id', created.user.id)
    if (holdError) {
      return {
        ok: false,
        message: `Account created but could NOT be held for approval — it is live now. Suspend ${v.fullName} on the roster immediately.`,
      }
    }
  }

  refresh()
  return {
    ok: true,
    message: v.holdForApproval
      ? `${v.fullName} registered and held for approval. They cannot sign in until you approve them.`
      : `${v.fullName} registered and approved. They can sign in now.`,
    id: created.user.id,
  }
}

export async function updateRider(riderId: string, formData: FormData): Promise<AdminResult> {
  const supabase = await admin().catch(() => null)
  if (!supabase) return { ok: false, message: 'Only a Super Admin can change rider settings.' }

  const parsed = riderUpdateSchema.safeParse({
    baseAreaId: formData.get('baseAreaId') || null,
    coverageKm: formData.get('coverageKm'),
    maxActiveOrders: formData.get('maxActiveOrders'),
    codFloatLimit: formData.get('codFloatLimit'),
    commissionPctOverride: formData.get('commissionPctOverride') || null,
    vehiclePlate: formData.get('vehiclePlate') || '',
  })
  if (!parsed.success) {
    return { ok: false, message: 'Check the fields below.', fieldErrors: parsed.error.flatten().fieldErrors }
  }
  const v = parsed.data

  const { error } = await supabase
    .from('rider_profiles')
    .update({
      base_area_id: v.baseAreaId,
      coverage_km: v.coverageKm,
      max_active_orders: v.maxActiveOrders,
      cod_float_limit: v.codFloatLimit,
      commission_pct_override: v.commissionPctOverride,
      vehicle_plate: v.vehiclePlate || null,
    })
    .eq('id', riderId)

  if (error) return { ok: false, message: explainAdminError(error.message) }
  refresh()
  return { ok: true, message: 'Rider settings saved.' }
}

/**
 * Activate / suspend a rider.
 *
 * `profiles.is_active` is checked by `requireUser`, by the middleware and by
 * `auth_role()` — which returns NULL for an inactive profile, so an inactive
 * rider fails every RLS policy that depends on a role. Suspension is therefore a
 * real revocation, not a UI flag.
 */
export async function setRiderActive(riderId: string, active: boolean): Promise<AdminResult> {
  const supabase = await admin().catch(() => null)
  if (!supabase) return { ok: false, message: 'Only a Super Admin can suspend riders.' }

  if (!active) {
    // Refuse while they are still carrying parcels or cash — suspending mid-trip
    // would strand a delivery and orphan the COD.
    const { data: rider } = await supabase
      .from('rider_profiles')
      .select('active_order_count')
      .eq('id', riderId)
      .maybeSingle()
    if ((rider?.active_order_count ?? 0) > 0) {
      return {
        ok: false,
        message: 'This rider is still carrying parcels. Reassign them on the dispatch board first.',
      }
    }
    const { data: cash } = await supabase.rpc('rider_cod_in_hand', { p_rider_id: riderId })
    if (Number(cash ?? 0) > 0) {
      return {
        ok: false,
        message: `This rider is holding ${Number(cash).toLocaleString()} Ks of company cash. Take the deposit and settle before suspending.`,
      }
    }
  }

  const { error } = await supabase.from('profiles').update({ is_active: active }).eq('id', riderId)
  if (error) return { ok: false, message: explainAdminError(error.message) }

  // Suspension must also take them off the map immediately.
  if (!active) {
    await supabase.from('rider_profiles').update({ is_online: false }).eq('id', riderId)
  }

  refresh()
  return { ok: true, message: active ? 'Rider activated.' : 'Rider suspended.' }
}

// ---------------------------------------------------------------------------
// Service areas
// ---------------------------------------------------------------------------

export async function saveArea(areaId: string | null, formData: FormData): Promise<AdminResult> {
  const supabase = await admin().catch(() => null)
  if (!supabase) return { ok: false, message: 'Only a Super Admin can change wards.' }

  const parsed = areaSchema.safeParse({
    name: formData.get('name'),
    nameMm: formData.get('nameMm') || '',
    sortOrder: formData.get('sortOrder'),
    isActive: formData.get('isActive') === 'on',
    zoneId: formData.get('zoneId'),
    lat: formData.get('lat') || null,
    lng: formData.get('lng') || null,
  })
  if (!parsed.success) {
    return { ok: false, message: 'Check the fields below.', fieldErrors: parsed.error.flatten().fieldErrors }
  }
  const v = parsed.data

  // PostGIS geography cannot be written through PostgREST as a plain value, so
  // the centroid goes in as WKT and Postgres casts it.
  const centroid =
    v.lat !== null && v.lng !== null ? `SRID=4326;POINT(${v.lng} ${v.lat})` : null

  const payload = {
    name: v.name,
    name_mm: v.nameMm || null,
    sort_order: v.sortOrder,
    is_active: v.isActive,
    // What the customer is charged to deliver here. NOT NULL in the database,
    // so this is the field that decides whether the area is bookable at all.
    zone_id: v.zoneId,
    ...(centroid !== null ? { centroid } : {}),
  }

  const { error } = areaId
    ? await supabase.from('service_areas').update(payload).eq('id', areaId)
    : await supabase.from('service_areas').insert(payload)

  if (error) {
    if (/duplicate key|unique/i.test(error.message)) {
      return { ok: false, message: 'A ward with that name already exists.', fieldErrors: { name: ['Already exists'] } }
    }
    return { ok: false, message: explainAdminError(error.message) }
  }

  refresh()
  return { ok: true, message: areaId ? 'Ward updated.' : 'Ward added.' }
}

// ---------------------------------------------------------------------------
// Delivery zones — the rate card
// ---------------------------------------------------------------------------

/**
 * Create or edit a zone.
 *
 * THIS CHANGES WHAT MERCHANTS PAY, which is why it is audited and why the code
 * is not editable. Two things it deliberately does NOT do:
 *
 *   - it does not touch orders already booked. `orders.delivery_fee` is a
 *     snapshot taken at booking, so a rate rise never rewrites a parcel a shop
 *     was already quoted for. That is the whole reason the column exists.
 *   - it does not delete. `service_areas.zone_id` is NOT NULL with an ON DELETE
 *     RESTRICT reference, so a zone that still prices areas cannot be removed —
 *     and should not be: deactivating it makes every one of its areas unbookable
 *     immediately, which is the honest version of "we stopped serving that
 *     price band" and leaves the history readable. Same reasoning as wards.
 */
export async function saveZone(
  zoneId: string | null,
  formData: FormData,
): Promise<AdminResult> {
  const supabase = await admin().catch(() => null)
  if (!supabase) return { ok: false, message: 'Only a Super Admin can change delivery rates.' }

  const parsed = zoneSchema.safeParse({
    name: formData.get('name'),
    nameMm: formData.get('nameMm') || '',
    fee: formData.get('fee'),
    deliveryDays: formData.get('deliveryDays'),
    sortOrder: formData.get('sortOrder'),
    isActive: formData.get('isActive') === 'on',
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Check the fields below.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  const v = parsed.data

  // Read the old row first, so the audit entry says what the fee CHANGED FROM.
  // An entry recording only the new value cannot answer "what were we charging
  // in September", which is the question an invoice dispute actually asks.
  const before = zoneId
    ? (await supabase.from('delivery_zones').select('*').eq('id', zoneId).maybeSingle()).data
    : null

  const payload = {
    name: v.name,
    name_mm: v.nameMm || null,
    fee: v.fee,
    delivery_days: v.deliveryDays,
    sort_order: v.sortOrder,
    is_active: v.isActive,
  }

  const result = zoneId
    ? await supabase.from('delivery_zones').update(payload).eq('id', zoneId).select('id').maybeSingle()
    : await supabase
        .from('delivery_zones')
        // A new zone needs a code and the form does not ask for one: the office
        // thinks in names, and a hand-typed handle is a typo waiting to collide
        // with the seeded ZONE_1 / ZONE_2. Derived, then uniqueness-checked by
        // the database.
        .insert({ ...payload, code: zoneCode(v.name) })
        .select('id')
        .maybeSingle()

  if (result.error) {
    if (/duplicate key|unique/i.test(result.error.message)) {
      return {
        ok: false,
        message: 'A zone with that name already exists.',
        fieldErrors: { name: ['Already exists'] },
      }
    }
    return { ok: false, message: explainAdminError(result.error.message) }
  }

  const id = result.data?.id ?? zoneId
  if (id) {
    await supabase.rpc('write_audit', {
      p_action: zoneId ? 'zone.update' : 'zone.create',
      p_table: 'delivery_zones',
      p_entity_id: id,
      p_before: before,
      p_after: { ...payload, id },
    })
  }

  refresh()

  // Say what it now COSTS, not just that it saved. A fee is the one field on
  // this form worth reading back.
  const changed = before && Number(before.fee) !== v.fee
  return {
    ok: true,
    message: changed
      ? `Saved. ${v.name} is now ${v.fee.toLocaleString('en-US')} Ks per parcel, was ${Number(before.fee).toLocaleString('en-US')} Ks. Orders already booked keep the fee they were quoted.`
      : `Saved. ${v.name} is ${v.fee.toLocaleString('en-US')} Ks per parcel, ${v.deliveryDays} day${v.deliveryDays === 1 ? '' : 's'}.`,
  }
}

/** `Zone 3 — Bago road` -> `ZONE_3_BAGO_ROAD`, trimmed to the column's 20. */
function zoneCode(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20)
    .replace(/_+$/, '')
  // A name of pure non-Latin characters (a Burmese-only zone name) slugs to
  // nothing, and `code` is NOT NULL with a length check. Fall back to something
  // unique rather than failing the save on a field the form never showed.
  return slug || `ZONE_${Date.now().toString(36).toUpperCase().slice(-8)}`
}

// ---------------------------------------------------------------------------
// Pricing & commission
// ---------------------------------------------------------------------------

/**
 * Update pricing.
 *
 * Changing the split does NOT touch orders already assigned — the commission is
 * snapshotted onto the order at assignment time (ARCHITECTURE.md D5), which is
 * asserted by a test. So this is safe to change mid-day.
 */
export async function updatePricing(
  _prev: AdminResult,
  formData: FormData,
): Promise<AdminResult> {
  const supabase = await admin().catch(() => null)
  if (!supabase) return { ok: false, message: 'Only a Super Admin can change pricing.' }

  const parsed = pricingSchema.safeParse({
    riderCommissionPct: formData.get('riderCommissionPct'),
    defaultCoverageKm: formData.get('defaultCoverageKm'),
    minParcelsPerTrip: formData.get('minParcelsPerTrip'),
    maxDeliveryAttempts: formData.get('maxDeliveryAttempts'),
    riderPingStaleMin: formData.get('riderPingStaleMin'),
    supportPhone: formData.get('supportPhone') || '',
  })
  if (!parsed.success) {
    return { ok: false, message: 'Check the fields below.', fieldErrors: parsed.error.flatten().fieldErrors }
  }
  const v = parsed.data

  const { error } = await supabase
    .from('app_settings')
    .update({
      rider_commission_pct: v.riderCommissionPct,
      default_coverage_km: v.defaultCoverageKm,
      min_parcels_per_trip: v.minParcelsPerTrip,
      max_delivery_attempts: v.maxDeliveryAttempts,
      rider_ping_stale_min: v.riderPingStaleMin,
      support_phone: v.supportPhone || null,
    })
    .eq('id', true)

  if (error) return { ok: false, message: explainAdminError(error.message) }
  refresh()
  return {
    ok: true,
    message: `Saved. New orders split ${v.riderCommissionPct}% rider / ${(100 - v.riderCommissionPct).toFixed(2)}% platform. Existing orders keep the rate they were assigned at.`,
  }
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export async function buildDaySettlements(periodDate: string): Promise<AdminResult> {
  const supabase = await admin().catch(() => null)
  if (!supabase) return { ok: false, message: 'Only a Super Admin can run settlement.' }

  const { data, error } = await supabase.rpc('build_settlements_for_day', { p_date: periodDate })
  if (error) return { ok: false, message: explainAdminError(error.message) }

  refresh()
  const count = Array.isArray(data) ? data.length : 0
  return {
    ok: count > 0,
    message:
      count > 0
        ? `Drafted ${count} settlement${count === 1 ? '' : 's'} for ${periodDate}.`
        : `Nothing to settle for ${periodDate} — no unsettled ledger entries.`,
  }
}

export async function buildRiderSettlement(riderId: string, periodDate: string): Promise<AdminResult> {
  const supabase = await admin().catch(() => null)
  if (!supabase) return { ok: false, message: 'Only a Super Admin can run settlement.' }

  const { error } = await supabase.rpc('build_settlement', {
    p_rider_id: riderId,
    p_date: periodDate,
  })
  if (error) return { ok: false, message: explainAdminError(error.message) }
  refresh()
  return { ok: true, message: 'Settlement drafted.' }
}

export async function approveSettlement(id: string): Promise<AdminResult> {
  const supabase = await admin().catch(() => null)
  if (!supabase) return { ok: false, message: 'Only a Super Admin can approve settlements.' }
  const { error } = await supabase.rpc('approve_settlement', { p_id: id })
  if (error) return { ok: false, message: explainAdminError(error.message) }
  refresh()
  revalidatePath(`/admin/super/settlements/${id}`)
  return { ok: true, message: 'Settlement approved.' }
}

export async function markSettlementPaid(id: string, note: string): Promise<AdminResult> {
  const supabase = await admin().catch(() => null)
  if (!supabase) return { ok: false, message: 'Only a Super Admin can mark settlements paid.' }
  const { error } = await supabase.rpc('mark_settlement_paid', { p_id: id, p_note: note || undefined })
  if (error) return { ok: false, message: explainAdminError(error.message) }
  refresh()
  revalidatePath(`/admin/super/settlements/${id}`)
  return { ok: true, message: 'Marked paid.' }
}

export async function reopenSettlement(id: string, reason: string): Promise<AdminResult> {
  const supabase = await admin().catch(() => null)
  if (!supabase) return { ok: false, message: 'Only a Super Admin can reopen settlements.' }
  if (!reason.trim()) return { ok: false, message: 'A reason is required to reopen a settlement.' }
  const { error } = await supabase.rpc('reopen_settlement', { p_id: id, p_reason: reason })
  if (error) return { ok: false, message: explainAdminError(error.message) }
  refresh()
  revalidatePath(`/admin/super/settlements/${id}`)
  return { ok: true, message: 'Settlement reopened for correction.' }
}

/** Rider hands cash in mid-shift, before any settlement is built. */
export async function remitCod(
  riderId: string,
  amount: number,
  memo: string,
): Promise<AdminResult> {
  const supabase = await admin().catch(() => null)
  if (!supabase) return { ok: false, message: 'Only a Super Admin can record deposits.' }
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, message: 'Enter a whole amount in kyat, greater than zero.' }
  }

  const { data, error } = await supabase.rpc('remit_cod', {
    p_rider_id: riderId,
    p_amount: amount,
    p_memo: memo || undefined,
  })
  if (error) return { ok: false, message: explainAdminError(error.message) }

  refresh()
  return {
    ok: true,
    message: `Deposit recorded. Rider now holds ${Number(data ?? 0).toLocaleString()} Ks.`,
  }
}

// ---------------------------------------------------------------------------
// Coverage area + base location
// ---------------------------------------------------------------------------

/**
 * Narrow the served box and move the map's home view.
 *
 * These are the SOFT bounds only. `public.in_service_area()` is a CHECK
 * constraint and stays the hard geofence; `coverageSchema` refuses anything that
 * would push these bounds outside it, because a map that accepts a pin the
 * database then rejects is worse than a map that is slightly too small.
 */
export async function updateCoverage(
  _prev: AdminResult,
  formData: FormData,
): Promise<AdminResult> {
  const supabase = await admin().catch(() => null)
  if (!supabase) return { ok: false, message: 'Only a Super Admin can change the coverage area.' }

  const parsed = coverageSchema.safeParse({
    bboxSouth: formData.get('bboxSouth'),
    bboxNorth: formData.get('bboxNorth'),
    bboxWest: formData.get('bboxWest'),
    bboxEast: formData.get('bboxEast'),
    mapCenterLat: formData.get('mapCenterLat'),
    mapCenterLng: formData.get('mapCenterLng'),
    mapDefaultZoom: formData.get('mapDefaultZoom'),
  })
  if (!parsed.success) {
    return { ok: false, message: 'Check the fields below.', fieldErrors: parsed.error.flatten().fieldErrors }
  }
  const v = parsed.data

  const { error } = await supabase
    .from('app_settings')
    .update({
      bbox_south: v.bboxSouth,
      bbox_north: v.bboxNorth,
      bbox_west: v.bboxWest,
      bbox_east: v.bboxEast,
      map_center_lat: v.mapCenterLat,
      map_center_lng: v.mapCenterLng,
      map_default_zoom: v.mapDefaultZoom,
    })
    .eq('id', true)

  if (error) return { ok: false, message: explainAdminError(error.message) }
  refresh()
  return { ok: true, message: 'Coverage area and base location saved.' }
}

// ---------------------------------------------------------------------------
// Manual ledger adjustment
// ---------------------------------------------------------------------------

/**
 * Book a correcting line against a rider.
 *
 * There is no other way to fix the ledger: `cod_ledger` has UPDATE and DELETE
 * revoked from `authenticated` outright (migration 0003), so history is append
 * only for everyone including a Super Admin. A mistake is reversed by writing
 * its opposite, which leaves both the error and the correction on the record.
 *
 * The line lands unsettled, so it moves the rider's open balance immediately and
 * is swept into their next settlement.
 */
export async function bookAdjustment(
  _prev: AdminResult,
  formData: FormData,
): Promise<AdminResult> {
  let ctx
  try {
    ctx = await assertRole('super_admin')
  } catch {
    return { ok: false, message: 'Only a Super Admin can book adjustments.' }
  }

  const parsed = adjustmentSchema.safeParse({
    riderId: formData.get('riderId'),
    direction: formData.get('direction'),
    amount: formData.get('amount'),
    memo: formData.get('memo'),
  })
  if (!parsed.success) {
    return { ok: false, message: 'Check the fields below.', fieldErrors: parsed.error.flatten().fieldErrors }
  }
  const v = parsed.data

  // Sign convention (see `comment on type public.ledger_kind`):
  // POSITIVE = rider owes the platform, NEGATIVE = platform owes the rider.
  const amount = v.direction === 'owed_by_rider' ? v.amount : -v.amount

  const supabase = await createClient()
  const { error } = await supabase.from('cod_ledger').insert({
    rider_id: v.riderId,
    kind: 'adjustment',
    amount,
    memo: v.memo,
    created_by: ctx.userId,
  })

  if (error) return { ok: false, message: explainAdminError(error.message) }
  refresh()
  return {
    ok: true,
    message: `Adjustment booked: ${amount > 0 ? '+' : ''}${amount.toLocaleString()} Ks against the rider's balance.`,
  }
}
