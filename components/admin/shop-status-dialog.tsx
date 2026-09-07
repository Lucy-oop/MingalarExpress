'use client'

import { useActionState, useEffect } from 'react'

export type StatusAction = 'activate' | 'suspend' | 'approve' | 'reject'
import { useFormStatus } from 'react-dom'
import { Ban, CheckCircle2 } from 'lucide-react'
import { setShopStatus, type ShopActionResult } from '@/lib/admin/shop-actions'
import { SUSPEND_REASONS, SUSPEND_REASON_LABEL } from '@/lib/validation/admin-shop'
import type { ShopListRow } from '@/lib/admin/shop-queries'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'

/**
 * The name is nullable because a row can be an owner with no shop attached yet.
 * That row never reaches here — the `shopId` guard below drops it — but a title
 * reading "Suspend null" is not worth risking on a type assertion.
 */
const TITLE: Record<StatusAction, (name: string) => string> = {
  suspend: (n) => `Suspend ${n}`,
  activate: (n) => `Activate ${n}`,
  approve: (n) => `Confirm ${n}`,
  reject: (n) => `Reject ${n}`,
}

const DESCRIPTION: Record<StatusAction, string> = {
  suspend: 'The shop stops accepting new orders immediately.',
  activate: 'The shop can create orders again, and its owner can sign in.',
  // Nothing to type: the shop supplied its own name, goods, phone and address
  // at setup. This is only the office saying yes.
  //
  // And saying yes to CASH, not to trading. It read "The shop can start booking
  // parcels straight away", which has not been true since 0031 -- the shop has
  // been booking prepaid parcels since it registered. Telling the office that
  // approval is what unblocks booking invites them to treat a working shop as a
  // queue to clear under pressure.
  approve: 'Cash on delivery is unlocked. The shop has been booking prepaid parcels since it registered.',
  reject: 'The shop is told no and leaves the queue. The reason is kept.',
}

const SUBMIT: Record<StatusAction, string> = {
  suspend: 'Suspend shop',
  activate: 'Activate shop',
  approve: 'Confirm shop',
  reject: 'Reject shop',
}

function Actions({ action, onCancel }: { action: StatusAction; onCancel: () => void }) {
  const suspending = action === 'suspend' || action === 'reject'
  const { pending } = useFormStatus()
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
        Cancel
      </Button>
      <Button type="submit" variant={suspending ? 'destructive' : 'default'} disabled={pending}>
        {suspending ? <Ban /> : <CheckCircle2 />}
        {pending ? 'Saving…' : SUBMIT[action]}
      </Button>
    </div>
  )
}

/**
 * Suspension needs a reason before it needs a confirmation.
 *
 * Cutting a shop off also locks its owner out of the platform when it is their
 * only shop, so "are you sure?" is the wrong question — "on what grounds?" is.
 * The answer goes to the audit log and surfaces in the shop drawer, which is
 * the only place anyone will look in three months when the owner rings up.
 */
export function ShopStatusDialog({
  row,
  action,
  onClose,
  onDone,
}: {
  row: ShopListRow | null
  action: StatusAction
  onClose: () => void
  onDone: (result: ShopActionResult) => void
}) {
  const [state, formAction] = useActionState<ShopActionResult, FormData>(setShopStatus, {
    ok: false,
    message: '',
  })
  const err = (k: string) => (state.ok ? undefined : state.fieldErrors?.[k]?.[0])
  // Reject stops a shop as surely as suspend does, and owes the same reason.
  const stopping = action === 'suspend' || action === 'reject'

  useEffect(() => {
    if (!state.ok) return
    onDone(state)
    onClose()
    // Depending on the callbacks would close the dialog whenever the parent
    // re-renders with fresh identities; the result object is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  if (!row?.shopId) return null

  return (
    <Overlay
      open
      onClose={onClose}
      side="center"
      title={TITLE[action](row.name ?? 'this shop')}
      description={DESCRIPTION[action]}
    >
      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="shopId" value={row.shopId} />
        <input type="hidden" name="action" value={action} />

        {!state.ok && state.message ? <Alert tone="error">{state.message}</Alert> : null}

        {stopping ? (
          <>
            <Alert tone="error" title="This also blocks the owner's login">
              {row.ownerName} will be unable to sign in — unless they own another shop that stays
              active. Orders already with a rider are still delivered.
            </Alert>

            <Field label="Reason" htmlFor="reason" required error={err('reason')}>
              <Select id="reason" name="reason" defaultValue="" required>
                <option value="">Choose a reason…</option>
                {SUSPEND_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {SUSPEND_REASON_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Detail"
              htmlFor="detail"
              hint="Required for “Other”. Written to the audit log permanently."
              error={err('detail')}
            >
              <Textarea
                id="detail"
                name="detail"
                placeholder="Commission unpaid since 12 Aug, three reminders sent"
              />
            </Field>
          </>
        ) : (
          <>
            <input type="hidden" name="reason" value="" />
            <Field
              label="Note"
              htmlFor="detail"
              hint="Optional. Recorded against the shop."
              error={err('detail')}
            >
              <Textarea id="detail" name="detail" placeholder="Commission settled in full" />
            </Field>
          </>
        )}

        <Actions action={action} onCancel={onClose} />
      </form>
    </Overlay>
  )
}
