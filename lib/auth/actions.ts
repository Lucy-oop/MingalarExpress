'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseEnv } from '@/lib/env'
import { ROLE_HOME } from '@/lib/auth/guards'
import { loginSchema, registerSchema } from '@/lib/validation/schemas'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164Myanmar } from '@/lib/utils'

export type AuthFormState = {
  error?: string
  fieldErrors?: Record<string, string[]>
}

/**
 * Supabase client, or a form-level error when the server is not configured.
 *
 * `requireSupabaseEnv()` throws, and a throw inside a Server Action surfaces as
 * an unhandled runtime error with a stack trace — on /auth/login and
 * /auth/register, which are PUBLIC pages. lib/env.ts's stated contract is that
 * public routes keep serving and protected ones fail closed, so a missing
 * configuration has to come back as an ordinary form result instead.
 *
 * It is still a server fault, not a user error, so it is logged at error level.
 * The env var names are only echoed to the browser outside production, where the
 * person reading the message is the person who can fix it.
 */
async function clientOrError(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; state: AuthFormState }
> {
  if (!getSupabaseEnv()) {
    console.error(
      '[auth] Supabase is not configured, so authentication cannot run. ' +
        'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.',
    )
    return {
      ok: false,
      state: {
        error:
          process.env.NODE_ENV === 'production'
            ? 'Accounts are temporarily unavailable. Please try again shortly.'
            : 'This app is not connected to Supabase yet. Set NEXT_PUBLIC_SUPABASE_URL and ' +
              'NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart the dev server.',
      },
    }
  }
  return { ok: true, supabase: await createClient() }
}

/** Only ever returns a safe destination inside this app. */
function safeNext(next: FormDataEntryValue | null): string | null {
  const value = typeof next === 'string' ? next : ''
  // Reject protocol-relative ('//evil.com') and absolute URLs outright.
  if (!value.startsWith('/') || value.startsWith('//')) return null
  return value
}

/**
 * Portal sign-in — email and password, all four roles.
 *
 * Email is the credential everywhere: the shop signup form, `registerRider`'s
 * Admin API call and the bootstrap admin all create accounts with an email, so
 * this is the one identifier every account is guaranteed to have.
 * `profiles.phone` is contact detail, not a credential.
 */
export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const client = await clientOrError()
  if (!client.ok) return client.state
  const { supabase } = client

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    // Do not distinguish "no such user" from "wrong password" -- that is an
    // account-enumeration oracle.
    return { error: 'Email or password is incorrect.' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', data.user.id)
    .single()

  if (!profile) {
    await supabase.auth.signOut()
    return { error: 'This account has no profile yet. Contact your dispatcher.' }
  }
  if (!profile.is_active) {
    await supabase.auth.signOut()
    return { error: 'This account has been disabled.' }
  }

  revalidatePath('/', 'layout')
  redirect(safeNext(formData.get('next')) ?? ROLE_HOME[profile.role])
}

const PHONE_TAKEN =
  'This phone number is already registered. Sign in instead, or use another number.'

/**
 * Is this number already on a profile?
 *
 * USES THE SERVICE ROLE, deliberately, and this is the one place in the app
 * where that is right for a read. Sign-up is unauthenticated: there is no
 * session for RLS to scope, and `profiles` is readable by nobody anonymous --
 * correctly, since it holds every rider's and every shop owner's phone number.
 * The alternative is a SECURITY DEFINER RPC granted to anon, which is the same
 * disclosure through more machinery and a migration.
 *
 * What crosses the boundary is one boolean about a number the caller already
 * typed. It does let someone probe whether a given number is registered -- the
 * same disclosure the form already makes for an email one line above.
 */
async function phoneTaken(e164: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('profiles')
      .select('id')
      .eq('phone', e164)
      .limit(1)
      .maybeSingle()
    return !!data
  } catch {
    // Never block a signup because this check could not run. The unique index
    // is still there; the worst case is the old opaque error, not a bad row.
    return false
  }
}

export async function signUpShop(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const e164 = toE164Myanmar(parsed.data.phone)
  if (!e164) return { fieldErrors: { phone: ['Enter a valid Myanmar mobile number.'] } }

  /*
    THE PHONE HAS TO BE FREE BEFORE WE ASK GOTRUE TO CREATE THE USER.

    `profiles.phone` carries a partial UNIQUE index (profiles_phone_key), and
    tg_on_auth_user_created inserts the profile inside the auth.users insert.
    Its `on conflict (id) do nothing` covers an id collision and nothing else,
    so a phone already on file raises 23505, the whole transaction rolls back,
    and GoTrue reports:

        AuthRetryableFetchError 500 "Database error saving new user"

    which is what a shop owner was being shown for the entirely ordinary mistake
    of reusing their number. It names no field, suggests no action, and reads
    like the site is broken.
  */
  if (await phoneTaken(e164)) return { fieldErrors: { phone: [PHONE_TAKEN] } }

  const client = await clientOrError()
  if (!client.ok) return client.state
  const { supabase } = client

  // NOTE: role is deliberately absent from this payload. Public signup can only
  // ever create a shop_owner -- tg_on_auth_user_created reads role from
  // raw_app_meta_data, which is service-role-only. Riders and dispatchers are
  // created by Super Admin through the Admin API (Phase 5).
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName, phone: e164 },
    },
  })

  if (error) {
    if (error.message.toLowerCase().includes('already registered')) {
      return { error: 'An account with this email already exists.' }
    }

    /*
      The check above is not a lock, so two people can claim the same number in
      the same instant. Rather than guess, ask again: if the phone is taken NOW
      and it was free a moment ago, that is exactly what happened and the field
      error is the truth.
    */
    if (await phoneTaken(e164)) return { fieldErrors: { phone: [PHONE_TAKEN] } }

    // Anything else is ours, not theirs. The raw text is a Postgres or GoTrue
    // string that means nothing to a shop owner, so it goes to the server log
    // and they get something they can act on.
    console.error('[signUpShop] unexpected auth error:', error.message)
    return {
      error: 'Could not create the account. Please try again, or contact the Mingalar Express office.',
    }
  }

  redirect('/auth/login?registered=1')
}

export async function signOut() {
  // Nothing to sign out of if the server was never configured, and throwing
  // here would strand the user on a page whose only escape is this button.
  if (getSupabaseEnv()) {
    const supabase = await createClient()
    await supabase.auth.signOut()
  }
  revalidatePath('/', 'layout')
  redirect('/auth/login')
}
