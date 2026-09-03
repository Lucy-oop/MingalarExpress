'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { MessageSquare, PhoneCall, ScrollText } from 'lucide-react'
import { addOrderNote, type NoteResult, type OrderNote } from '@/lib/admin/notes'
import { NOTE_CHANNELS, NOTE_PARTIES } from '@/lib/validation/schemas'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { ShareOrderLink } from '@/components/admin/share-order-link'
import { formatDateTimeYangon } from '@/lib/utils'

/**
 * The office's record of a parcel.
 *
 * Since 0016 there is no automated message, so the loop is a rider ringing the
 * office and the office ringing the shop. This is where that ends up, because
 * otherwise it ends up nowhere — a Viber conversation at 4pm is invisible to
 * whoever picks the parcel up at 9am.
 *
 * Append-only, and the UI says so rather than hiding it. There is no edit and no
 * delete: a correction is another entry, and both stay.
 */

const PARTY_LABEL: Record<string, string> = {
  shop: 'the shop',
  customer: 'the customer',
  rider: 'the rider',
  other: 'someone',
}

const CHANNEL_LABEL: Record<string, string> = {
  phone: 'by phone',
  viber: 'on Viber',
  telegram: 'on Telegram',
  in_person: 'in person',
  other: '',
}

export function OrderNotes({
  orderId,
  orderCode,
  notes,
  /** Drives the heading only — the log is worth keeping on every parcel. */
  needsAttention,
}: {
  orderId: string
  orderCode: string
  notes: OrderNote[]
  needsAttention: boolean
}) {
  const [state, action] = useActionState<NoteResult | null, FormData>(addOrderNote, null)
  const [kind, setKind] = React.useState<'note' | 'contact'>('note')
  const formRef = React.useRef<HTMLFormElement>(null)

  // Clear the box only once the entry is actually filed. Wiping it on submit
  // loses what somebody typed the moment the network is bad, which on Yangon
  // mobile data is often.
  React.useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset()
      setKind('note')
    }
  }, [state])

  return (
    <Card className={needsAttention ? 'border-amber-300' : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          Contact log
          {notes.length > 0 ? <Badge tone="neutral">{notes.length}</Badge> : null}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <ShareOrderLink code={orderCode} />

        <form ref={formRef} action={action} className="space-y-2 border-t pt-4">
          <input type="hidden" name="orderId" value={orderId} />

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Entry type">
              {(
                [
                  { v: 'note', label: 'Note', icon: MessageSquare },
                  { v: 'contact', label: 'Spoke to', icon: PhoneCall },
                ] as const
              ).map((t) => (
                <button
                  key={t.v}
                  type="button"
                  onClick={() => setKind(t.v)}
                  aria-pressed={kind === t.v}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${
                    kind === t.v
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <t.icon className="size-3.5" aria-hidden="true" />
                  {t.label}
                </button>
              ))}
            </div>
            <input type="hidden" name="kind" value={kind} />

            {/* Only meaningful on a contact — and the schema nulls them anyway,
                so a stale selection cannot be filed against a plain note. */}
            {kind === 'contact' ? (
              <>
                <Select name="party" aria-label="Who was reached" className="h-8 w-auto text-xs">
                  <option value="">Who…</option>
                  {NOTE_PARTIES.map((p) => (
                    <option key={p} value={p}>
                      {PARTY_LABEL[p]}
                    </option>
                  ))}
                </Select>
                <Select name="channel" aria-label="How" className="h-8 w-auto text-xs">
                  <option value="">How…</option>
                  {NOTE_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {c === 'in_person' ? 'in person' : c}
                    </option>
                  ))}
                </Select>
              </>
            ) : null}
          </div>

          <Textarea
            name="body"
            rows={2}
            required
            maxLength={2000}
            aria-label="What happened"
            placeholder={
              kind === 'contact'
                ? 'e.g. U Aung on Viber — happy to wait, try again Thursday morning'
                : 'e.g. Rider says the address is a closed shopfront, needs checking'
            }
          />

          {state && !state.ok ? <Alert tone="error">{state.message}</Alert> : null}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Saved with your name and the time. Entries cannot be edited or removed.
            </p>
            <SaveButton />
          </div>
        </form>

        {notes.length === 0 ? (
          <p className="border-t pt-4 text-sm text-muted-foreground">
            Nothing recorded yet. Anything said on the phone about this parcel belongs here.
          </p>
        ) : (
          <ol className="space-y-3 border-t pt-4">
            {notes.map((n) => (
              <li key={n.id} className="flex gap-3 text-sm">
                <div
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${
                    n.kind === 'decision'
                      ? 'bg-primary'
                      : n.kind === 'contact'
                        ? 'bg-emerald-500'
                        : 'bg-muted-foreground/40'
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words">{n.body}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {n.kind === 'decision' ? 'Decision · ' : null}
                    {n.kind === 'contact' && n.party
                      ? `Spoke to ${PARTY_LABEL[n.party] ?? n.party} ${
                          n.channel ? (CHANNEL_LABEL[n.channel] ?? n.channel) : ''
                        } · `
                      : null}
                    {n.authorName ?? 'Someone since removed'}
                    {' · '}
                    {formatDateTimeYangon(n.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Add to log'}
    </Button>
  )
}
