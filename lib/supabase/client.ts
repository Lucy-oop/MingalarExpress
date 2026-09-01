'use client'

import { createBrowserClient } from '@supabase/ssr'
import { requireSupabaseEnv } from '@/lib/env'
import type { Database } from '@/types/database.types'

/**
 * Browser Supabase client. Safe to call repeatedly -- @supabase/ssr memoises the
 * underlying client per set of arguments, so component-level calls do not open
 * new connections or duplicate the realtime socket.
 *
 * Only ever holds the anon key. Every read and write is filtered by RLS.
 */
export function createClient() {
  const { url, anonKey } = requireSupabaseEnv()
  return createBrowserClient<Database>(url, anonKey)
}
