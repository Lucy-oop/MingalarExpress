'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { TablesUpdate } from '@/types/database.types'
import { createAdminClient } from '@/lib/supabase/admin'
import { setupLinkFor } from '@/lib/auth/setup-link'
import { PHONE_TAKEN_ADMIN, phoneTaken } from '@/lib/auth/phone'
import { assertRole } from '@/lib/auth/guards'
import { explainAdminError } from '@/lib/admin/errors'
import {
  SUSPEND_REASON_LABEL,
  shopEditSchema,
  shopOnboardExistingOwnerSchema,
  shopOnboardNewOwnerSchema,
  shopStatusSchema,
} from '@/lib/validation/admin-shop'

export type ShopActionResult =
  | { ok: true; message: string; id?: string; inviteLink?: string; warning?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> }

function refresh() {
  revalidatePath('/admin/shops')
  revalidatePath('/admin/super')
  revalidatePath('/admin/audit')
  revalidatePath('/admin/dispatcher')
}

const FORBIDDEN = 'Only a Super Admin can manage shops.'

/** Common form fields for both onboarding branches and for editing. */
function shopCoreFrom(formData: FormData) {
  return {
    name: formData.get('name'),
    phone: formData.get('phone'),
    areaId: formData.get('areaId'),
    pickupAddress: formData.get('pickupAddress'),
    pickupPoint: { lat: formData.get('pickupLat'), lng: formData.get('pickupLng') },
    pickupNote: formData.get('pickupNote') ?? '',
  }
}

function fieldErrorsOf(error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) {
  const flat = error.flatten().fieldErrors
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(flat)) if (v?.length) out[k] = v
  return out
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Activate or suspend a shop.
 *
 * What actually blocks a suspended owner from signing in is
 * `profiles.is_active = false`: `signIn` checks it and signs the session out,
 * `requireUser` redirects, and `auth_role()` returns NULL for an inactive
 * profile so every RLS policy that depends on a role fails. `shops.is_active`
 * alone would only stop the shop being usable, not stop the login.
 *
 * The `app_metadata.suspended` stamp is the third layer: `updateSession` takes a
 * fast path that trusts `app_metadata.role` and skips the `is_active` read
 * entirely, so without this flag the middleware would wave a suspended
 * admin-created account through to the page (RLS still stops it — this is a UX
 * gate, not the boundary). Writing the flag closes that gap.
 *
 * One owner may hold more than one shop. Suspending a single shop must NOT lock
 * them out of the others, so the login block is applied only when no active
 * shop remains.
 */
export async function setShopStatus(
  _prev: ShopActionResult,
  formData: FormData,
): Promise<ShopActionResult> {
  let ctx
  try {
    ctx = await assertRole('super_admin')
  } catch {
    return { ok: false, message: FORBIDDEN }
  }

  const parsed = shopStatusSchema.safeParse({
    shopId: formData.get('shopId'),
    action: formData.get('action'),
    reason: formData.get('reason'),
    detail: formData.get('detail') ?? '',
  })
  if (!parsed.success) {
    return { ok: false, message: 'Check the fields below.', fieldErrors: fieldErrorsOf(parsed.error) }
  }
  const { shopId, action, reason, detail } = parsed.data

  /*
    APPROVE AND REJECT ARE THE OFFICE'S FIRST DECISION; activate and suspend are
    later ones. They share this action because they share everything that
    matters -- the audit row, the owner's login, the auth-metadata stamp -- and
    splitting them would mean two places to keep those in step.

    A shop is trading after approve or activate, and not after reject or
    suspend.
  */
  const stopping = action === 'suspend' || action === 'reject'
  const suspending = stopping

  const supabase = await createClient()

  const { data: shop } = await supabase
    .from('shops')
    .select('id, name, owner_id, is_active, approved_at, rejected_at')
    .eq('id', shopId)
    .maybeSingle()
  if (!shop) return { ok: false, message: 'That shop no longer exists.' }

  // Orders already on a rider are not cancelled by suspending the shop — they
  // still have to reach a customer. Reported so the operator is not surprised.
  const { count: inFlight } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('shop_id', shopId)
    .in('status', ['pending', 'assigned', 'picked_up'])

  /*
    The decision columns, which `tg_shops_guard` (0026) permits only for an
    admin.

    LETTING A SHOP TRADE ALWAYS CLEARS A REJECTION, and stamps the approval when
    there was not one. Otherwise activating a rejected shop would leave
    `rejected_at` set: the table would read Active while `shopApprovalState`
    still said rejected and every booking stayed blocked, with nothing on either
    screen to explain why.
  */
  const now = new Date().toISOString()
  const decision: TablesUpdate<'shops'> = {}
  if (!stopping) {
    decision.rejected_at = null
    decision.rejection_reason = null
    if (!shop.approved_at) {
      decision.approved_at = now
      decision.approved_by = ctx.userId
    }
  } else if (action === 'reject') {
    decision.rejected_at = now
    decision.rejection_reason = [reason, detail].filter(Boolean).join(': ') || null
  }

  const { error: shopError } = await supabase
    .from('shops')
    .update({ is_active: !suspending, ...decision })
    .eq('id', shopId)
  if (shopError) return { ok: false, message: explainAdminError(shopError.message) }

  // Does this owner still have somewhere to trade after the change?
  const { data: siblings } = await supabase
    .from('shops')
    .select('id, is_active')
    .eq('owner_id', shop.owner_id)
  const stillTrading = (siblings ?? []).some((s) => (s.id === shopId ? !suspending : s.is_active))
  const lockOwner = suspending && !stillTrading

  let warning: string | undefined

  if (lockOwner || !suspending) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ is_active: !suspending })
      .eq('id', shop.owner_id)
    if (profileError) {
      warning = `The shop was ${suspending ? 'suspended' : 'activated'}, but the owner's login could not be updated: ${explainAdminError(profileError.message)}`
    } else {
      warning = await stampAuthMetadata(shop.owner_id, suspending, reason, detail)
    }
  }

  const label = reason ? SUSPEND_REASON_LABEL[reason] : null

  // The reason exists to be findable later, so it goes to the audit log rather
  // than only into a toast the operator dismisses.
  await supabase.rpc('write_audit', {
    p_action: `shop.${action}`,
    p_table: 'shops',
    p_entity_id: shopId,
    p_before: { is_active: shop.is_active, approved_at: shop.approved_at, rejected_at: shop.rejected_at },
    p_after: {
      is_active: !suspending,
      reason,
      reason_label: label,
      detail: detail || null,
      owner_locked: lockOwner,
      actor: ctx.profile.full_name,
    },
  })

  refresh()

  // Four verbs, because "reactivated" is a lie to an owner who has never been
  // active and "suspended" is a lie to one who was never approved.
  const VERB: Record<typeof action, string> = {
    // Not "it can book parcels now": it could already. Approval unlocks cash.
    approve: 'confirmed — cash on delivery is now unlocked',
    reject: 'rejected',
    activate: 'reactivated',
    suspend: 'suspended',
  }
  const parts = [`${shop.name} ${VERB[action]}${label ? ` — ${label.toLowerCase()}` : ''}.`]
  if (lockOwner) parts.push('The owner can no longer sign in.')
  else if (suspending) parts.push('The owner keeps access to their other shops.')
  if (suspending && (inFlight ?? 0) > 0) {
    parts.push(
      `${inFlight} order${inFlight === 1 ? '' : 's'} already in the system will still be delivered.`,
    )
  }

  return { ok: true, message: parts.join(' '), warning }
}

/**
 * Mirror the suspension into `app_metadata`.
 *
 * Returns a warning string rather than throwing: the DB flags above are what
 * genuinely revoke access, so a missing service-role key must degrade to a
 * smaller guarantee, not abandon a half-finished suspension.
 *
 * The existing metadata is spread through deliberately — dropping
 * `app_metadata.role` would silently change which branch `updateSession` takes
 * for that user, and for a rider it is the only role source the DB trigger
 * trusts.
 */
async function stampAuthMetadata(
  ownerId: string,
  suspended: boolean,
  reason: string | null,
  detail: string,
): Promise<string | undefined> {
  let service
  try {
    service = createAdminClient()
  } catch {
    return 'SUPABASE_SERVICE_ROLE_KEY is not configured, so the auth-level suspension flag was not written. The account is still blocked by its profile.'
  }

  const { data: existing, error: readError } = await service.auth.admin.getUserById(ownerId)
  if (readError || !existing.user) {
    return 'The auth-level suspension flag could not be written. The account is still blocked by its profile.'
  }

  const { error } = await service.auth.admin.updateUserById(ownerId, {
    app_metadata: {
      ...existing.user.app_metadata,
      suspended,
      suspended_reason: suspended ? reason : null,
      suspended_detail: suspended && detail ? detail : null,
      suspended_at: suspended ? new Date().toISOString() : null,
    },
  })

  return error
    ? 'The auth-level suspension flag could not be written. The account is still blocked by its profile.'
    : undefined
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export async function updateShop(
  _prev: ShopActionResult,
  formData: FormData,
): Promise<ShopActionResult> {
  try {
    await assertRole('super_admin')
  } catch {
    return { ok: false, message: FORBIDDEN }
  }

  const shopId = String(formData.get('shopId') ?? '')
  if (!shopId) return { ok: false, message: 'No shop selected.' }

  const parsed = shopEditSchema.safeParse(shopCoreFrom(formData))
  if (!parsed.success) {
    return { ok: false, message: 'Check the fields below.', fieldErrors: fieldErrorsOf(parsed.error) }
  }
  const v = parsed.data

  const supabase = await createClient()
  const { error } = await supabase
    .from('shops')
    .update({
      name: v.name,
      phone: v.phone,
      area_id: v.areaId,
      pickup_address: v.pickupAddress,
      pickup_lat: v.pickupPoint.lat,
      pickup_lng: v.pickupPoint.lng,
      pickup_note: v.pickupNote || null,
    })
    .eq('id', shopId)

  if (error) return { ok: false, message: explainAdminError(error.message) }

  refresh()
  return { ok: true, message: `${v.name} updated.`, id: shopId }
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

/**
 * Register a shop.
 *
 * Two branches, because two different things may be missing. An owner who
 * signed up publicly already has an auth user and a profile but no `shops` row
 * — that is the "pending setup" state, and it needs a shop, not a second
 * account. A walk-in needs both.
 *
 * Note what is NOT set on the new user: `app_metadata.role`. `claimed_role()`
 * already defaults to `shop_owner`, and leaving the key absent keeps
 * `updateSession` on the branch that reads `profiles.is_active` on every
 * request — which is strictly safer for an account this panel can suspend.
 */
export async function onboardShop(
  _prev: ShopActionResult,
  formData: FormData,
): Promise<ShopActionResult> {
  try {
    await assertRole('super_admin')
  } catch {
    return { ok: false, message: FORBIDDEN }
  }

  const supabase = await createClient()
  const mode = formData.get('ownerMode') === 'existing' ? 'existing' : 'new'

  // ---- attach a shop to an owner who already signed up --------------------
  if (mode === 'existing') {
    const parsed = shopOnboardExistingOwnerSchema.safeParse({
      ...shopCoreFrom(formData),
      ownerId: formData.get('ownerId'),
    })
    if (!parsed.success) {
      return { ok: false, message: 'Check the fields below.', fieldErrors: fieldErrorsOf(parsed.error) }
    }
    const v = parsed.data

    const { data, error } = await supabase
      .from('shops')
      .insert({
        owner_id: v.ownerId,
        name: v.name,
        phone: v.phone,
        area_id: v.areaId,
        pickup_address: v.pickupAddress,
        pickup_lat: v.pickupPoint.lat,
        pickup_lng: v.pickupPoint.lng,
        pickup_note: v.pickupNote || null,
      })
      .select('id')
      .single()

    if (error) return { ok: false, message: explainAdminError(error.message) }

    await auditOnboard(supabase, data.id, v.name, 'existing_owner')
    refresh()
    return { ok: true, message: `${v.name} registered. The owner can create orders now.`, id: data.id }
  }

  // ---- create the owner account and the shop ------------------------------
  const parsed = shopOnboardNewOwnerSchema.safeParse({
    ...shopCoreFrom(formData),
    ownerName: formData.get('ownerName'),
    ownerEmail: formData.get('ownerEmail'),
    ownerPhone: formData.get('ownerPhone') ?? '',
    credential: formData.get('credential') === 'invite' ? 'invite' : 'password',
    password: formData.get('password') ?? '',
  })
  if (!parsed.success) {
    return { ok: false, message: 'Check the fields below.', fieldErrors: fieldErrorsOf(parsed.error) }
  }
  const v = parsed.data

  let service
  try {
    service = createAdminClient()
  } catch {
    return {
      ok: false,
      message:
        'SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so new accounts cannot be created. Ask the owner to sign up at /auth/register, then attach their shop here.',
    }
  }

  const { data: created, error: authError } = await service.auth.admin.createUser({
    email: v.ownerEmail,
    ...(v.credential === 'password' ? { password: v.password } : {}),
    email_confirm: true,
    user_metadata: { full_name: v.ownerName, ...(v.ownerPhone ? { phone: v.ownerPhone } : {}) },
  })

  if (authError || !created.user) {
    const message = authError?.message ?? 'Could not create that account.'
    if (/already been registered|already exists/i.test(message)) {
      return {
        ok: false,
        message: 'An account with that email already exists — attach the shop to that owner instead.',
        fieldErrors: { ownerEmail: ['Already registered'] },
      }
    }
    /*
      Asked of the database, not read off the message. This branch used to match
      /duplicate key|profiles_phone_key/ and had therefore never once fired:
      the constraint name is in the Postgres error but supabase-js returns only
      "Database error creating new user", with no code and no field. Verified
      against staging while fixing the same bug on the rider path.
    */
    if (v.ownerPhone && (await phoneTaken(v.ownerPhone))) {
      return {
        ok: false,
        message: PHONE_TAKEN_ADMIN,
        fieldErrors: { ownerPhone: ['Already in use'] },
      }
    }
    return { ok: false, message }
  }

  const { data: shop, error: shopError } = await supabase
    .from('shops')
    .insert({
      owner_id: created.user.id,
      name: v.name,
      phone: v.phone,
      area_id: v.areaId,
      pickup_address: v.pickupAddress,
      pickup_lat: v.pickupPoint.lat,
      pickup_lng: v.pickupPoint.lng,
      pickup_note: v.pickupNote || null,
    })
    .select('id')
    .single()

  if (shopError) {
    // The account exists and is usable; only the shop failed. Say so precisely
    // rather than implying nothing happened — a retry would hit "already
    // registered" and read as a contradiction.
    return {
      ok: false,
      message: `The owner account for ${v.ownerEmail} was created, but the shop did not save: ${explainAdminError(shopError.message)} Register the shop against that owner from the pending list.`,
    }
  }

  await auditOnboard(supabase, shop.id, v.name, 'new_owner')

  let inviteLink: string | undefined
  let warning: string | undefined
  if (v.credential === 'invite') {
    const { data: link, error: linkError } = await service.auth.admin.generateLink({
      type: 'magiclink',
      email: v.ownerEmail,
    })
    /*
      `hashed_token`, not `action_link`.

      This path has never been able to sign anybody in. `action_link` points at
      GoTrue's /auth/v1/verify, which redirects with the session in the URL
      FRAGMENT -- unreadable by a server -- so /auth/callback found no `code`
      and sent the new owner to the login page. On staging it also redirected to
      `http://localhost:3000`, the project's unchanged Site URL. Found while
      building the rider setup QR, which had the identical defect.

      `setupLinkFor` builds a link against this app's own origin instead, and
      /auth/confirm exchanges it server-side. No `next`: the confirm route sends
      them to their role's home, which for a brand-new owner is the shop
      dashboard and its "set up my shop" prompt.
    */
    const tokenHash = link?.properties?.hashed_token
    const built = tokenHash ? await setupLinkFor(tokenHash) : null
    if (linkError || !built) {
      // Points at flows that exist. There is no password-reset page in this
      // app -- app/auth has only login, register, callback and confirm -- so
      // the old advice to "send a password reset from the login page" sent an
      // operator looking for a button nobody ever built.
      warning =
        'The account was created but a sign-in link could not be generated. Register the owner with a password, or have them sign up at /auth/register and attach the shop.'
    } else {
      inviteLink = built
    }
  }

  refresh()
  return {
    ok: true,
    id: shop.id,
    inviteLink,
    warning,
    message:
      v.credential === 'password'
        ? `${v.name} registered. Give ${v.ownerName} their email and password in person.`
        : `${v.name} registered. Copy the sign-in link below — it is shown once.`,
  }
}

async function auditOnboard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  shopId: string,
  name: string,
  via: 'new_owner' | 'existing_owner',
) {
  await supabase.rpc('write_audit', {
    p_action: 'shop.onboard',
    p_table: 'shops',
    p_entity_id: shopId,
    p_after: { name, via, detail: `Registered by the office (${via.replace('_', ' ')})` },
  })
}
