'use server'

import { revalidatePath } from 'next/cache'
import { assertRole } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { orderNoteSchema } from '@/lib/validation/schemas'

/**
 * The contact log behind a parcel — what the office was told, by whom, when.
 *
 * Dispatch-only, in RLS and here. `order_notes_read_dispatch` is the boundary;
 * the `assertRole` below is a courtesy that turns a would-be empty list into an
 * honest error, not the thing keeping anyone out.
 *
 * There is no update and no delete, and no action for one. The table has no
 * policy that would permit either, so a correction is a new entry — which is
 * the point of writing it down at all.
 */

export type OrderNote = {
  id: number
  kind: 'note' | 'contact' | 'decision'
  party: string | null
  channel: string | null
  body: string
  createdAt: string
  authorName: string | null
  authorRole: string | null
}

export type NoteResult = { ok: true } | { ok: false; message: string; field?: string }

export async function getOrderNotes(orderId: string): Promise<OrderNote[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('order_notes')
    .select('id, kind, party, channel, body, created_at, author_role, author:author_id (full_name)')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })

  // A log that fails to load must not take the parcel page down with it — the
  // addresses and the money are what someone opened the page for.
  if (error) {
    console.error('[notes] could not read the contact log:', error.message)
    return []
  }

  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind as OrderNote['kind'],
    party: r.party,
    channel: r.channel,
    body: r.body,
    createdAt: r.created_at,
    authorName: (r.author as unknown as { full_name: string } | null)?.full_name ?? null,
    authorRole: r.author_role,
  }))
}

export async function addOrderNote(
  _prev: NoteResult | null,
  formData: FormData,
): Promise<NoteResult> {
  const ctx = await assertRole('dispatcher', 'super_admin').catch(() => null)
  if (!ctx) {
    return { ok: false, message: 'Your session has expired. Sign in again and retry.' }
  }

  const parsed = orderNoteSchema.safeParse({
    orderId: formData.get('orderId'),
    kind: formData.get('kind') || 'note',
    party: formData.get('party') ?? '',
    channel: formData.get('channel') ?? '',
    body: formData.get('body'),
  })

  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      message: issue?.message ?? 'Check the entry and try again.',
      field: issue?.path[0]?.toString(),
    }
  }

  const { orderId, kind, party, channel, body } = parsed.data
  const supabase = await createClient()

  const { error } = await supabase.from('order_notes').insert({
    order_id: orderId,
    // The WITH CHECK demands this matches auth.uid(), so a note can never be
    // filed under a colleague's name.
    author_id: ctx.userId,
    author_role: ctx.profile.role,
    kind,
    party,
    channel,
    body,
  })

  if (error) {
    // 42501 is the policy refusing the insert; anything else is worth showing.
    return {
      ok: false,
      message:
        error.code === '42501'
          ? 'You do not have permission to write on this parcel.'
          : `Could not save the note: ${error.message}`,
    }
  }

  revalidatePath(`/admin/orders/${orderId}`)
  return { ok: true }
}
