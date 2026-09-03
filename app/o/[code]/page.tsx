import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * The short link an SMS carries.
 *
 * `/o/MGE-260901-000009` instead of `/shop/orders/<uuid>` because a UUID is 36
 * characters of a 70-character Burmese SMS segment — see MAX_LINK_BASE_LENGTH in
 * lib/notifications/messages.ts. The code is already in the message body, so
 * this costs nothing extra to read.
 *
 * The lookup runs under the visitor's own RLS: a shop resolves its own parcel
 * and lands on the page, and anyone else falls through to the filtered list,
 * where middleware sends them to log in first. There is no information here a
 * stranger could not get by guessing codes at /track.
 */
export default async function ShortOrderLink({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const supabase = await createClient()

  const { data } = await supabase
    .from('orders')
    .select('id')
    .eq('code', decodeURIComponent(code).toUpperCase())
    .maybeSingle()

  if (data?.id) redirect(`/shop/orders/${data.id}`)

  // Not theirs, not signed in, or no such code. The list handles all three, and
  // middleware sends an anonymous visitor to log in on the way.
  redirect(`/shop/orders?q=${encodeURIComponent(code)}`)
}
