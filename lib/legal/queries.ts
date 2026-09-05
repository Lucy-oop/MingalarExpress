import { createClient } from '@/lib/supabase/server'

/**
 * Has this person accepted a policy, and which wording.
 *
 * RLS does the scoping (`policy_acceptances_read_own`): the row set is already
 * this user's, so there is no `.eq('profile_id', …)` here and there should not
 * be — a filter in application code would imply it is the thing protecting the
 * data. Dispatch reads everyone's by the same policy, which is why the caller
 * passes no id at all.
 */
export async function getAcceptedPolicyVersion(policyKey: string): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('policy_acceptances')
    .select('version, accepted_at')
    .eq('policy_key', policyKey)
    .order('accepted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // A policy prompt is not worth taking a page down for. A failed read means we
  // ask again, which is the safe direction: showing the terms twice is a
  // nuisance, never showing them is the problem.
  if (error) return null
  return data?.version ?? null
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
