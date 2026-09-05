import { createClient } from '@/lib/supabase/server'
import type { AcceptanceRead } from '@/lib/legal/gate'

/**
 * Has this person accepted a policy, and which wording.
 *
 * RLS does the scoping (`policy_acceptances_read_own`): the row set is already
 * this user's, so there is no `.eq('profile_id', …)` here and there should not
 * be — a filter in application code would imply it is the thing protecting the
 * data. Dispatch reads everyone's by the same policy, which is why the caller
 * passes no id at all.
 *
 * THE THREE OUTCOMES ARE NOT TWO. This used to answer with `string | null`,
 * collapsing "no acceptance on file" and "the read itself failed" into the same
 * value. That was harmless while the terms were a dismissible prompt and is
 * fatal behind a gate: a missing table or a dropped connection would read as
 * "has not accepted" and lock every shop out of every page, with a Continue
 * button failing for the same reason. See shouldBlock() in ./gate.
 */
export async function readPolicyAcceptance(policyKey: string): Promise<AcceptanceRead> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('policy_acceptances')
    .select('version, accepted_at')
    .eq('policy_key', policyKey)
    .order('accepted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    // Loud, because this is the state that silently lets shops past the gate,
    // and the migration not being pushed is the likeliest cause.
    console.error(`[policy] could not read acceptance for ${policyKey}: ${error.message}`)
    return { status: 'unknown' }
  }
  if (!data?.version) return { status: 'none' }
  return { status: 'accepted', version: data.version }
}

/** When they accepted it, for the "Accepted on …" line on the settings page. */
export async function getPolicyAcceptedAt(policyKey: string): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('policy_acceptances')
    .select('accepted_at')
    .eq('policy_key', policyKey)
    .order('accepted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return null
  return data?.accepted_at ?? null
}
