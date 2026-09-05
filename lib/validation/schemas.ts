import { z } from 'zod'
import { THINGANGYUN_BBOX } from '@/lib/geo/thingangyun'
import { MAX_MMK } from '@/lib/validation/limits'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Accepts what a Myanmar user actually types (09..., 9..., +959...) and
 * normalises to the strict +959XXXXXXXXX that the DB CHECK constraint demands.
 * Keep this in step with the SQL regex: '^\+959[0-9]{7,9}$'.
 */
export const myanmarPhone = z
  .string()
  .trim()
  .min(1, 'Phone number is required')
  .transform((raw) => {
    const digits = raw.replace(/[^\d]/g, '')
    let national = digits
    if (national.startsWith('95')) national = national.slice(2)
    if (national.startsWith('0')) national = national.slice(1)
    return national.startsWith('9') ? `+95${national}` : raw
  })
  .refine((v) => /^\+959\d{7,9}$/.test(v), 'Enter a valid Myanmar mobile, e.g. 09 791 234 567')

export const optionalMyanmarPhone = z
  .union([z.literal(''), myanmarPhone])
  .transform((v) => (v === '' ? null : v))

/**
 * Whole MMK. Rejects decimals outright rather than silently rounding money.
 *
 * The ceiling lives in `./limits` so the booking form can apply the same one
 * without importing Zod into the client bundle. Note it bounds the GOODS value
 * the shop types, not the collectable total — see the note in that file.
 */
export const mmk = z.coerce
  .number({ error: 'Enter an amount in kyat' })
  .int('Amount must be a whole number of kyat')
  .min(0, 'Amount cannot be negative')
  .max(MAX_MMK, 'Amount looks too large — check the value')

const lat = z.coerce.number().min(-90).max(90)
const lng = z.coerce.number().min(-180).max(180)

/**
 * Mirrors the SQL CHECK `public.in_service_area()`. Validating here as well is
 * not redundant: it turns a 500-level constraint violation into a field-level
 * message pointing at the map pin the user needs to move.
 */
/**
 * A Postgres `uuid` column value — NOT an RFC 9562 UUID.
 *
 * Zod 4's `.uuid()` enforces the version and variant nibbles. Postgres does not:
 * its `uuid` type accepts any 32 hex digits in 8-4-4-4-12 shape, and this
 * project's own seed uses ids like `aaaaaaaa-0000-0000-0000-000000000001` that
 * are entirely valid columns and entirely invalid RFC UUIDs.
 *
 * Validating more strictly than the database rejects values the database itself
 * holds. That is how "Select a shop" appeared for a shop the server had already
 * resolved correctly from the session: the id was right, the rule was wrong.
 *
 * `z.guid()` is Zod 4's shape-only check, which is exactly Postgres's rule.
 * Use this for anything read out of, or written into, a uuid column.
 */
export const dbId = (message = 'Invalid id') => z.guid(message)

export const servicePoint = z
  .object({ lat, lng })
  .refine(
    (p) =>
      p.lat >= THINGANGYUN_BBOX.south &&
      p.lat <= THINGANGYUN_BBOX.north &&
      p.lng >= THINGANGYUN_BBOX.west &&
      p.lng <= THINGANGYUN_BBOX.east,
    'That location is outside our delivery area (Greater Yangon). Move the pin closer in.',
  )

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').pipe(z.email('Enter a valid email')),
  password: z.string().min(1, 'Password is required'),
})


export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Shop or owner name is required').max(120),
    email: z.string().trim().min(1, 'Email is required').pipe(z.email('Enter a valid email')),
    phone: z.string().trim().min(1, 'Phone number is required'),
    password: z.string().min(8, 'Use at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

// ---------------------------------------------------------------------------
// Order intake (Phase 2)
// ---------------------------------------------------------------------------

export const orderCreateSchema = z
  .object({
    shopId: dbId('Select a shop'),

    pickupAddress: z.string().trim().min(5, 'Pickup address is required').max(300),
    pickupPoint: servicePoint,
    pickupContact: z.string().trim().max(120).optional().or(z.literal('')),
    pickupNote: z.string().trim().max(300).optional().or(z.literal('')),

    customerName: z.string().trim().min(2, "Customer's name is required").max(160),
    customerPhone: myanmarPhone,
    customerPhoneAlt: optionalMyanmarPhone.optional(),
    dropoffAddress: z.string().trim().min(5, 'Delivery address is required').max(300),
    // REQUIRED since the flat-route pricing change: the destination area is
    // what selects the route, and the route is what sets delivery_fee. An order
    // with no area cannot be priced, and could never be loaded onto a run
    // either — the planning board groups the unrouted pool by area.
    dropoffAreaId: dbId('Choose the destination area'),
    dropoffPoint: servicePoint,
    dropoffNote: z.string().trim().max(300).optional().or(z.literal('')),

    /**
     * OPTIONAL, with a default — it used to be required.
     *
     * The booking form was fourteen inputs and a shop books parcels between
     * customers; "what is inside" was the one required field that carried no
     * consequence. Nothing prices on it, nothing routes on it and no constraint
     * depends on it: the rider sees it under Contents, and `Fragile` — which
     * does change handling — is its own flag.
     *
     * The DB still demands 1..500 characters (`parcel_desc` is NOT NULL), so a
     * blank becomes 'Parcel' here rather than reaching Postgres as a 23514 the
     * shop cannot act on.
     */
    parcelDesc: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : 'Parcel')),
    parcelWeightG: z.coerce.number().int().min(0).max(50_000).nullable().optional(),
    parcelValue: mmk.nullable().optional(),
    isFragile: z.coerce.boolean().default(false),

    paymentMethod: z.enum(['cod', 'prepaid']),
    codAmount: mmk.default(0),
    deliveryFee: mmk,
    feePayer: z.enum(['customer', 'shop']).default('customer'),
  })
  // Mirrors the SQL constraint `orders_cod_consistent`. Without this the user
  // gets a raw 23514 from Postgres instead of a message on the right field.
  .refine((v) => v.paymentMethod !== 'cod' || v.codAmount > 0, {
    message: 'A COD order needs a collection amount greater than zero',
    path: ['codAmount'],
  })
  .refine((v) => v.paymentMethod !== 'prepaid' || v.codAmount === 0, {
    message: 'A prepaid order must have a COD amount of 0',
    path: ['codAmount'],
  })

export type OrderCreateInput = z.input<typeof orderCreateSchema>
export type OrderCreateValues = z.output<typeof orderCreateSchema>

export const quoteRequestSchema = z.object({
  pickup: z.object({ lat, lng }),
  dropoff: z.object({ lat, lng }),
})

// ---------------------------------------------------------------------------
// Shop self-service
// ---------------------------------------------------------------------------

/**
 * What a shop owner may change about their own shop.
 *
 * Deliberately a subset of the columns `shops_owner_all` permits: `is_active` is
 * an office decision and `owner_id` is identity, so neither is here. The pickup
 * point mirrors the SQL CHECK on `shops.pickup_geog` via `servicePoint`.
 */
export const shopSettingsSchema = z.object({
  name: z.string().trim().min(2, 'Shop name is required').max(120),
  phone: myanmarPhone,
  pickupAddress: z.string().trim().min(5, 'Pickup address is required').max(300),
  pickupPoint: servicePoint,
  pickupNote: z.string().trim().max(300).optional().or(z.literal('')),
})

export type ShopSettingsValues = z.output<typeof shopSettingsSchema>

// ---------------------------------------------------------------------------
// Contact log (migration 0017)
// ---------------------------------------------------------------------------

export const NOTE_KINDS = ['note', 'contact'] as const
export const NOTE_PARTIES = ['shop', 'customer', 'rider', 'other'] as const
export const NOTE_CHANNELS = ['phone', 'viber', 'telegram', 'in_person', 'other'] as const

/**
 * One entry in a parcel's contact log.
 *
 * `decision` is absent from NOTE_KINDS on purpose: those rows are written by
 * `resolve_failed_order` and must not be typeable by hand, or the log stops
 * being evidence of what the system actually did.
 *
 * The party/channel pair is cleared unless the entry is a `contact`, mirroring
 * the `order_notes_contact_shape` CHECK. Sending "phone" with a plain note gets
 * a 23514 from Postgres, which reaches the user as an unexplainable failure —
 * so it is normalised here instead of validated into an error.
 */
export const orderNoteSchema = z
  .object({
    orderId: dbId('Unknown order'),
    kind: z.enum(NOTE_KINDS, { error: 'Pick note or contact' }).default('note'),
    party: z.union([z.literal(''), z.enum(NOTE_PARTIES)]).optional(),
    channel: z.union([z.literal(''), z.enum(NOTE_CHANNELS)]).optional(),
    body: z
      .string()
      .trim()
      .min(1, 'Write what happened')
      .max(2000, 'Keep it under 2,000 characters'),
  })
  .transform((v) => ({
    ...v,
    party: v.kind === 'contact' ? (v.party || null) : null,
    channel: v.kind === 'contact' ? (v.channel || null) : null,
  }))

export type OrderNoteValues = z.output<typeof orderNoteSchema>
