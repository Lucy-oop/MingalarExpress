import { z } from 'zod'
import { THINGANGYUN_BBOX } from '@/lib/geo/thingangyun'
import { mmk, myanmarPhone, optionalMyanmarPhone } from '@/lib/validation/schemas'

/**
 * Super Admin input schemas (Phase 5).
 *
 * Every rule here mirrors a SQL CHECK. That duplication is the point: Postgres
 * raises 23514 with a constraint name, which is useless in a form. Validating
 * first turns the same rule into a message on the field the operator has to fix.
 * When a CHECK moves, move its twin here.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * An untouched <input> arrives as '' and an omitted one as null. Neither may
 * reach z.coerce.number(), which turns both into 0 -- a silent 0% commission or
 * a 0 Ks float limit. Blank means "not set", so it is mapped to null *before*
 * any coercion runs.
 */
export const blankToNull = (v: unknown) => (v === '' || v === null || v === undefined ? null : v)

const nullableNumber = (inner: z.ZodType<number, unknown>) =>
  z.preprocess(blankToNull, z.union([z.null(), inner]))

/** numeric(4,1) coverage_km: 0.5 .. 30.0 (rider_profiles + app_settings). */
const coverageKm = z.coerce
  .number({ error: 'Enter a radius in kilometres' })
  .min(0.5, 'Minimum radius is 0.5 km')
  .max(30, 'Maximum radius is 30 km')

/** smallint max_active_orders: 1 .. 10. */
const maxActiveOrders = z.coerce
  .number({ error: 'Enter a parcel limit' })
  .int('Whole parcels only')
  .min(1, 'A rider must be able to carry at least one parcel')
  .max(10, 'Ten parcels is the hard ceiling')

/** numeric(5,2) 0 .. 100, used for both the global split and the override. */
const commissionPct = z.coerce
  .number({ error: 'Enter a percentage' })
  .min(0, 'Cannot be below 0%')
  .max(100, 'Cannot be above 100%')

const lat = z.coerce.number({ error: 'Enter a latitude' }).min(-90).max(90)
const lng = z.coerce.number({ error: 'Enter a longitude' }).min(-180).max(180)

// ---------------------------------------------------------------------------
// Riders
// ---------------------------------------------------------------------------

/** Shared operating parameters — the columns tg_riders_guard reserves to admins. */
const riderOperatingFields = {
  baseAreaId: z.union([z.null(), z.string().uuid('Select a valid ward')]),
  coverageKm,
  maxActiveOrders,
  codFloatLimit: mmk,
  vehiclePlate: z.string().trim().max(32, 'Plate is too long'),
}

export const riderCreateSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the rider's full name").max(120),
  email: z.string().trim().min(1, 'Email is required').pipe(z.email('Enter a valid email')),
  phone: myanmarPhone,
  password: z.string().min(8, 'Use at least 8 characters'),
  ...riderOperatingFields,
  nrcNo: z.string().trim().max(40, 'NRC is too long'),
  /**
   * Riders cannot self-register — public signup can only ever mint a
   * shop_owner, because app_metadata is service-role-only. So "approval" is the
   * gap between creating the account and letting it sign in: the account is
   * created with profiles.is_active = false and stays inert (auth_role() returns
   * NULL for an inactive profile, so every RLS policy fails) until an admin
   * approves it on the roster.
   */
  holdForApproval: z.coerce.boolean(),
})

export const riderUpdateSchema = z.object({
  ...riderOperatingFields,
  /**
   * Null means "follow the global rate". assign_order reads
   * coalesce(commission_pct_override, app_settings.rider_commission_pct), so
   * clearing this is how a rider is put back on the standard split.
   */
  commissionPctOverride: nullableNumber(commissionPct),
})

// ---------------------------------------------------------------------------
// Pricing & commission
// ---------------------------------------------------------------------------

export const pricingSchema = z.object({
  riderCommissionPct: commissionPct,
  baseDeliveryFee: mmk,
  perKmFee: mmk,
  freeKm: z.coerce
    .number({ error: 'Enter a distance' })
    .min(0, 'Cannot be negative')
    .max(30, 'A free allowance above 30 km is not a delivery fee'),
  // road_factor < 1 would price a route as shorter than the crow flies.
  roadFactor: z.coerce
    .number({ error: 'Enter a road factor' })
    .min(1, 'Roads are never shorter than the straight line — minimum 1.0')
    .max(3, 'Above 3.0 is not a road factor, it is a surcharge'),
  defaultCoverageKm: coverageKm,
  // Replaced offerTtlSeconds, which died with the offer engine in 0009. Mirrors
   // the CHECK on app_settings.min_parcels_per_trip (0 .. 500). 0 is allowed and
   // means "no volume rule", which is a legitimate operational choice — the
   // break-even warning is separate and cannot be switched off.
   minParcelsPerTrip: z.coerce
    .number({ error: 'Enter a parcel count' })
    .int('Whole parcels only')
    .min(0, 'Cannot be negative — use 0 to switch the rule off')
    .max(500, 'A minimum above 500 exceeds what any run can carry'),
  riderPingStaleMin: z.coerce
    .number({ error: 'Enter a number of minutes' })
    .int('Whole minutes only')
    .min(1, 'Minimum 1 minute')
    .max(120, 'Maximum 120 minutes'),
  supportPhone: optionalMyanmarPhone,
})

// ---------------------------------------------------------------------------
// Service areas (wards)
// ---------------------------------------------------------------------------

export const areaSchema = z
  .object({
    name: z.string().trim().min(1, 'Ward name is required').max(80),
    nameMm: z.string().trim().max(80, 'Name is too long'),
    sortOrder: z.coerce
      .number({ error: 'Enter a sort position' })
      .int('Whole numbers only')
      .min(0, 'Cannot be negative')
      .max(32767, 'Too large'),
    isActive: z.coerce.boolean(),
    lat: nullableNumber(lat),
    lng: nullableNumber(lng),
  })
  // A half-set centroid would write POINT(null …) and fail in Postgres.
  .refine((v) => (v.lat === null) === (v.lng === null), {
    message: 'Give both a latitude and a longitude, or neither',
    path: ['lat'],
  })
  .refine(
    (v) =>
      v.lat === null ||
      v.lng === null ||
      (v.lat >= THINGANGYUN_BBOX.south &&
        v.lat <= THINGANGYUN_BBOX.north &&
        v.lng >= THINGANGYUN_BBOX.west &&
        v.lng <= THINGANGYUN_BBOX.east),
    {
      message: 'That centroid is outside Thingangyun Township.',
      path: ['lat'],
    },
  )

// ---------------------------------------------------------------------------
// Coverage area + base location
// ---------------------------------------------------------------------------

/**
 * The SOFT service bounds and the map's home view.
 *
 * The hard geofence is `public.in_service_area()`, a CHECK constraint, and
 * widening it is a migration. These bounds are the tunable copy the UI uses to
 * reject a pin early — so they may only ever be narrowed *within* the hard box.
 * Letting an operator widen them here would produce the worst failure mode
 * available: a map that accepts a pin the database then refuses.
 */
export const coverageSchema = z
  .object({
    bboxSouth: lat,
    bboxNorth: lat,
    bboxWest: lng,
    bboxEast: lng,
    mapCenterLat: lat,
    mapCenterLng: lng,
    mapDefaultZoom: z.coerce
      .number({ error: 'Enter a zoom level' })
      .int('Whole zoom levels only')
      .min(10, 'Below z10 the township is a dot')
      .max(19, 'z19 is the deepest OSM tile'),
  })
  .refine((v) => v.bboxSouth < v.bboxNorth, {
    message: 'South must be below north',
    path: ['bboxSouth'],
  })
  .refine((v) => v.bboxWest < v.bboxEast, {
    message: 'West must be left of east',
    path: ['bboxWest'],
  })
  .refine((v) => v.bboxSouth >= THINGANGYUN_BBOX.south && v.bboxNorth <= THINGANGYUN_BBOX.north, {
    message: `Must stay inside the ${THINGANGYUN_BBOX.south}–${THINGANGYUN_BBOX.north} geofence. Widening it needs a migration.`,
    path: ['bboxSouth'],
  })
  .refine((v) => v.bboxWest >= THINGANGYUN_BBOX.west && v.bboxEast <= THINGANGYUN_BBOX.east, {
    message: `Must stay inside the ${THINGANGYUN_BBOX.west}–${THINGANGYUN_BBOX.east} geofence. Widening it needs a migration.`,
    path: ['bboxWest'],
  })
  // A home view outside the served box drops every operator on empty tiles.
  .refine(
    (v) =>
      v.mapCenterLat >= v.bboxSouth &&
      v.mapCenterLat <= v.bboxNorth &&
      v.mapCenterLng >= v.bboxWest &&
      v.mapCenterLng <= v.bboxEast,
    { message: 'The base location must sit inside the coverage box', path: ['mapCenterLat'] },
  )

// ---------------------------------------------------------------------------
// Manual ledger adjustment
// ---------------------------------------------------------------------------

/**
 * The ONLY correction mechanism. cod_ledger has no UPDATE or DELETE grant, so a
 * mistake is reversed by booking its opposite. Sign follows the ledger_kind
 * convention: positive = rider owes the platform.
 */
export const adjustmentSchema = z.object({
  riderId: z.string().uuid('Select a rider'),
  direction: z.enum(['owed_by_rider', 'owed_to_rider']),
  amount: mmk.refine((v) => v > 0, 'Enter an amount greater than zero'),
  memo: z.string().trim().min(3, 'Say why — this line is permanent').max(200),
})
