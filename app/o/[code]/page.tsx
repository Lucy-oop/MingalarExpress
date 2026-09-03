import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * The short link the office pastes into a chat.
 *
 * `/o/MGE-260901-000009` instead of `/shop/orders/<uuid>`. Built to fit a
 * Burmese SMS segment; the SMS went in 0016 and this outlived it, because a
 * 36-character UUID is just as unreadable in a Viber message as it was in a
 * text — and since 0016 a Viber message is how the office actually reaches a
 * shop. `components/admin/share-order-link` is the copy button.
 *
 * The lookup runs under the visitor's own RLS: a shop resolves its own parcel
 * and lands on the page, dispatch resolves any, and anyone else falls through
 * to the filtered list, where middleware sends them to log in first. There is
 * no information here a stranger could not get by guessing codes at /track.
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
