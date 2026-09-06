'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { assertRole } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { setupRefusal } from '@/lib/admin/rider-setup-rules'

/**
 * Getting a rider's phone signed in, once.
 *
 * WHAT THIS IS FOR, and what it is not. A rider is onboarded standing at the
 * office counter; the office types their details and hands the phone back
 * signed in. After that the PWA holds the session and the rider never signs in
 * again. So this is a SETUP tool -- first phone, replacement phone, wiped phone
 * -- and deliberately not "how riders log in". Treating it as a login method is
 * what leads to a long-lived link, and a long-lived magic link is a standing
 * credential.
 *
 * WHY A LINK AND NOT AN SMS CODE. Phone OTP would resurrect exactly the
 * dependency migration 0016 removed: a per-segment cost and a sender-ID
 * registration that never cleared. `generateLink` costs nothing per use and --
 * this is the part that matters operationally -- it RETURNS the link rather
 * than mailing it, so it never touches the project's SMTP quota. This codebase
 * has already been knocked over once by `over_email_send_rate_limit`.
 *
 * THE LINK IS A BEARER CREDENTIAL. Whoever holds it becomes this rider, and a
 * rider can mark parcels collected and delivered and carries COD cash. That is
 * a money-integrity problem, not a convenience one, which is why every mint
 * writes an audit row naming the admin who asked for it. Without that trail
 * "who marked this parcel delivered" has no answer, because the office could
 * have been the rider.
 */

export type RiderSetupResult =
  | { ok: true; link: string; riderName: string }
  | { ok: false; message: string }

export type RiderRevokeResult = { ok: boolean; message: string }

const NO_SERVICE_KEY =
  'SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so setup links cannot be minted.'

/**
 * A held or suspended rider gets nothing.
 *
 * `app/auth/callback/route.ts` already refuses to complete a sign-in for an
 * inactive profile, so a link minted here would fail anyway -- but failing at
 * the counter, after the rider has scanned it, is a support call. Refusing to
 * create it at all is the same rule enforced a step earlier, where somebody can
 * still do something about it.
 */
async function loadRider(riderId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('id', riderId)
    .maybeSingle()
  return { supabase, profile: data }
}

export async function createRiderSetupLink(riderId: string): Promise<RiderSetupResult> {
  try {
    await assertRole('super_admin')
  } catch {
    return { ok: false, message: 'Only a Super Admin can set up a rider phone.' }
  }

  const { supabase, profile } = await loadRider(riderId)
  const refusal = setupRefusal(
    profile ? { role: profile.role, isActive: profile.is_active } : null,
  )
  if (refusal || !profile) return { ok: false, message: refusal ?? 'That rider no longer exists.' }

  let service
  try {
    service = createAdminClient()
  } catch {
    return { ok: false, message: NO_SERVICE_KEY }
  }

  /*
    The email is read server-side from auth.users rather than carried on the
    roster. It is only ever an argument to generateLink -- there is no reason
    for a rider's login identifier to reach a browser, and the roster does not
    select it today.
  */
  const { data: authUser, error: lookupError } = await service.auth.admin.getUserById(riderId)
  const email = authUser?.user?.email
  if (lookupError || !email) {
    return {
      ok: false,
      message: 'That rider has no sign-in email on file, so a link cannot be generated.',
    }
  }

  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const tokenHash = link?.properties?.hashed_token
  if (linkError || !tokenHash) {
    return {
      ok: false,
      message: `A setup link could not be generated: ${linkError?.message ?? 'unknown error'}`,
    }
  }

  /*
    THE LINK IS BUILT HERE, not taken from `link.properties.action_link`.

    That field points at GoTrue's own /auth/v1/verify, which redirects to the
    project's Site URL carrying the session in the URL FRAGMENT
    (`#access_token=...`). A fragment never reaches a server, so our Route
    Handler cannot read it -- verified against staging, where the link also
    redirects to `http://localhost:3000` because that is what Site URL is set
    to. A rider scanning that QR would be sent to their own phone's localhost.

    Pointing at our own /auth/confirm with the token hash fixes all of it: the
    QR encodes this app's domain, the session is exchanged server-side into
    HttpOnly cookies, and it does not depend on a dashboard setting being right.
  */
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return { ok: false, message: 'Could not determine this site’s address.' }
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const setupLink = `${proto}://${host}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink&next=%2Frider%2Fdashboard`

  /*
    Written through the REQUEST-scoped client, not the service client:
    `write_audit` records `auth.uid()`, and the service role has none. Minting
    with the service key and auditing with the admin's own session is what puts
    a name against the row.

    The link itself is NOT in the audit payload. The audit log is readable by
    every admin, and a bearer credential sitting in a table anyone can select is
    the whole risk this feature is trying to bound.
  */
  await supabase.rpc('write_audit', {
    p_action: 'rider.setup_link',
    p_table: 'profiles',
    p_entity_id: riderId,
    p_before: null,
    p_after: { rider: profile.full_name, method: 'magiclink' },
  })

  return { ok: true, link: setupLink, riderName: profile.full_name }
}

/**
 * Kill an outstanding link.
 *
 * HOW THIS ACTUALLY WORKS, because it is not obvious: GoTrue keeps one
 * magic-link token hash per user, so minting a second link overwrites the
 * first. Generating one and throwing it away is therefore a real revocation of
 * whatever is sitting in a Viber thread -- not a flag, not a soft delete.
 *
 * WHAT IT DOES NOT DO, stated plainly so nobody relies on it for more than it
 * is: it does not end a session the rider is already in. An access token is a
 * signed JWT and PostgREST honours it until it expires, whatever we do here --
 * banning the user would not change that either. The immediate, total kill in
 * this system is `setRiderActive(riderId, false)`: `auth_role()` returns NULL
 * for an inactive profile, so every RLS policy that depends on a role fails at
 * once, and `requireUser` and the middleware both bounce them. That action
 * already exists, already refuses while a rider is carrying parcels or cash,
 * and the dialog points at it.
 */
export async function revokeRiderSetupLink(riderId: string): Promise<RiderRevokeResult> {
  try {
    await assertRole('super_admin')
  } catch {
    return { ok: false, message: 'Only a Super Admin can revoke a setup link.' }
  }

  const { supabase, profile } = await loadRider(riderId)
  if (!profile) return { ok: false, message: 'That rider no longer exists.' }

  let service
  try {
    service = createAdminClient()
  } catch {
    return { ok: false, message: NO_SERVICE_KEY }
  }

  const { data: authUser } = await service.auth.admin.getUserById(riderId)
  const email = authUser?.user?.email
  if (!email) return { ok: false, message: 'That rider has no sign-in email on file.' }

  const { error } = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) {
    return { ok: false, message: `Could not revoke the link: ${error.message}` }
  }

  // Also take them off the dispatch map. A lost phone that is still showing as
  // online will be offered work.
  await service.from('rider_profiles').update({ is_online: false }).eq('id', riderId)

  await supabase.rpc('write_audit', {
    p_action: 'rider.setup_link_revoked',
    p_table: 'profiles',
    p_entity_id: riderId,
    p_before: null,
    p_after: { rider: profile.full_name },
  })

  revalidatePath('/admin/super/riders')
  return {
    ok: true,
    message: `Any setup link for ${profile.full_name} has stopped working, and they are marked offline.`,
  }
}
