import { z } from 'zod'
import { dbId, myanmarPhone, optionalMyanmarPhone, servicePoint } from '@/lib/validation/schemas'
import { blankToNull } from '@/lib/validation/admin'

/**
 * Shop management input schemas (Super Admin).
 *
 * As with `admin.ts`, every rule here has a twin in SQL — `shops` carries NOT
 * NULL on the pickup point, a phone regex, a name length CHECK and
 * `shops_pickup_in_service_area`. Validating first turns a 23514 with a
 * constraint name into a message on the field the operator has to fix.
 */

// ---------------------------------------------------------------------------
// Suspension reasons
// ---------------------------------------------------------------------------

/**
 * Suspending a shop locks its owner out of the platform, so the reason is not
 * optional decoration: it is written to `audit_log` and is the only record of
 * why an account was cut off. A free-text box alone would fill with "asked to";
 * a fixed vocabulary plus a detail field stays queryable.
 */
export const SUSPEND_REASONS = [
  'unpaid_commission',
  'fraudulent_orders',
  'shop_closed',
  'other',
] as const

export type SuspendReason = (typeof SUSPEND_REASONS)[number]

export const SUSPEND_REASON_LABEL: Record<SuspendReason, string> = {
  unpaid_commission: 'Unpaid commission',
  fraudulent_orders: 'Fraudulent orders',
  shop_closed: 'Shop closed',
  other: 'Other (describe below)',
}

export const shopStatusSchema = z
  .object({
    shopId: dbId('Select a shop'),
    action: z.enum(['activate', 'suspend', 'approve', 'reject']),
    reason: z.preprocess(blankToNull, z.union([z.null(), z.enum(SUSPEND_REASONS)])),
    detail: z.string().trim().max(300, 'Keep it under 300 characters'),
  })
  // Rejecting is as final as suspending -- the shop is told no and leaves the
  // queue -- so it carries the same obligation to say why.
  .refine((v) => !['suspend', 'reject'].includes(v.action) || v.reason !== null, {
    message: 'Choose a reason',
    path: ['reason'],
  })
  // "Other" with no explanation is the same as no reason at all.
  .refine((v) => v.reason !== 'other' || v.detail.length >= 3, {
    message: 'Describe the reason — this is written to the audit log permanently',
    path: ['detail'],
  })

// ---------------------------------------------------------------------------
// Shop details
// ---------------------------------------------------------------------------

const shopCoreShape = {
  name: z.string().trim().min(1, 'Shop name is required').max(160, 'Shop name is too long'),
  phone: myanmarPhone,
  areaId: z.preprocess(blankToNull, z.union([z.null(), dbId('Select a valid ward')])),
  pickupAddress: z
    .string()
    .trim()
    .min(5, 'Pickup address is required')
    .max(300, 'Address is too long'),
  /**
   * Mirrors `shops_pickup_in_service_area`. A shop outside the township cannot
   * be saved at all — the CHECK would reject the row — so catching it here is
   * the difference between a field error and a 500.
   */
  pickupPoint: servicePoint,
  pickupNote: z.string().trim().max(300, 'Note is too long'),
}

export const shopEditSchema = z.object(shopCoreShape)

// ---------------------------------------------------------------------------
// Manual onboarding
// ---------------------------------------------------------------------------

/**
 * Two ways in, because two things are actually being created.
 *
 * A shop owner who signed up publicly already has an auth user and a `profiles`
 * row — nothing has created their `shops` row, which is the "pending" state.
 * They can fix that themselves at `/shop/setup`, so this path is for the office
 * doing it FOR them: a shop attached to an existing owner, NOT a second
 * account.
 *
 * Walk-in registration needs both.
 */
export const shopOnboardExistingOwnerSchema = z.object({
  ...shopCoreShape,
  ownerId: dbId('Select the owner account'),
})

export const shopOnboardNewOwnerSchema = z
  .object({
    ...shopCoreShape,
    ownerName: z.string().trim().min(2, "Enter the owner's full name").max(120),
    ownerEmail: z.string().trim().min(1, 'Email is required').pipe(z.email('Enter a valid email')),
    /** Optional: `profiles.phone` is uniquely indexed, so a duplicate is a real error. */
    ownerPhone: optionalMyanmarPhone,
    /**
     * `password` hands credentials over in person, which is how this business
     * actually onboards. `invite` mints a one-time sign-in link instead, for
     * when the owner is not standing at the counter.
     */
    credential: z.enum(['password', 'invite']),
    password: z.string(),
  })
  .refine((v) => v.credential !== 'password' || v.password.length >= 8, {
    message: 'Use at least 8 characters',
    path: ['password'],
  })

export type ShopEditValues = z.output<typeof shopEditSchema>
export type ShopOnboardNewOwnerValues = z.output<typeof shopOnboardNewOwnerSchema>
export type ShopOnboardExistingOwnerValues = z.output<typeof shopOnboardExistingOwnerSchema>

// ---------------------------------------------------------------------------
// List filters
// ---------------------------------------------------------------------------

/*
  Four states now, and the two new ones are the point of 0026:

    pending    signed up, has not described their shop yet
    awaiting   described it, the office has not looked -- TRADING, prepaid
    active     reviewed, cash on delivery unlocked
    suspended  switched off, cannot book at all

  `awaiting` and `suspended` were one thing before, and they call for opposite
  actions -- carry on booking, versus ring the office. Note that `awaiting` is
  not a blocked state: since 0031 approval gates CASH, not trade, which is why
  its label reads "Active · COD locked".
*/
export const SHOP_STATUSES = ['awaiting', 'active', 'suspended', 'pending'] as const
export type ShopStatus = (typeof SHOP_STATUSES)[number]

/*
  `awaiting` IS NOT WAITING TO TRADE, and the old label said it was.

  Since 0031 a shop in this state is switched on and booking prepaid parcels
  from its first minute -- what it is waiting for is the COD unlock, and calling
  that "Awaiting approval" told the office a working shop was blocked and told
  anyone reading over their shoulder that instant onboarding had not happened.
  The label now states both halves, because both are true at once.

  `pending` is the genuinely blocked one and keeps its name: an owner who signed
  up and has no shop row at all.
*/
export const SHOP_STATUS_LABEL: Record<ShopStatus, string> = {
  awaiting: 'Active · COD locked',
  active: 'Active',
  suspended: 'Suspended',
  pending: 'Pending setup',
}

/** Narrows an untrusted `?status=` to a real value, or undefined for "all". */
export function parseShopStatus(raw: string | undefined): ShopStatus | undefined {
  return SHOP_STATUSES.includes(raw as ShopStatus) ? (raw as ShopStatus) : undefined
}
