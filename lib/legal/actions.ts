'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'

export type AcceptResult = { ok: true } | { ok: false; message: string }

/**
 * Record that the signed-in user accepted a policy version.
 *
 * THE PROFILE ID COMES FROM THE SESSION, never from the caller. The whole value
 * of this table is that a row means the named person agreed; accepting an id
 * from the client would make it mean "somebody claimed they did". RLS enforces
 * the same thing independently (`profile_id = auth.uid()` in the WITH CHECK),
 * so this is belt and braces on the one record that has to stand up later.
 *
 * Re-accepting the same version is a no-op rather than an error: the unique
 * constraint says the two facts are one fact, and a double-submitted button
 * should not surface as a failure.
 */
export async function acceptPolicy(
  policyKey: string,
  version: string,
): Promise<AcceptResult> {
  const { userId } = await requireUser()
  const supabase = await createClient()

  const { error } = await supabase
    .from('policy_acceptances')
    .upsert(
      { profile_id: userId, policy_key: policyKey, version },
      { onConflict: 'profile_id,policy_key,version', ignoreDuplicates: true },
    )

  if (error) return { ok: false, message: 'Could not record that. Please try again.' }

  revalidatePath('/shop', 'layout')
  return { ok: true }
}
