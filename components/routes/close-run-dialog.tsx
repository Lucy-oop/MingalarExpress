'use client'

import { Banknote, Lock } from 'lucide-react'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { formatMmk } from '@/lib/utils'
import type { BoardTrip } from '@/lib/routes/queries'

/**
 * Close a run, and take the rider's cash in the same act (0052).
 *
 * The office's model: a rider never keeps cash to cover their pay. They hand in
 * every kyat each run and are paid their earnings at the monthly settlement. So
 * the figure here is the WHOLE cash the run collected -- nothing is netted off
 * it -- and confirming records that exact amount as handed in, closes the run,
 * and books the rider's pay as unsettled earnings, all in one transaction.
 *
 * The amount is passed back to the server with the confirmation, and the
 * server refuses if the ledger no longer agrees: confirming a figure that has
 * since changed is not a confirmation of the cash in the office's hand.
 */
export function CloseRunDialog({
  trip,
  wayName,
  busy,
  onClose,
  onConfirm,
}: {
  trip: BoardTrip | null
  wayName: string
  busy: boolean
  onClose: () => void
  onConfirm: (expectedCash: number) => void
}) {
  const cash = trip?.runCash ?? 0

  return (
    <Overlay
      open={trip !== null}
      onClose={onClose}
      side="center"
      title="Close run & deposit cash"
      description={`${wayName}${trip?.riderName ? ` · ${trip.riderName}` : ''}`}
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy || !trip} onClick={() => onConfirm(cash)}>
            {cash > 0 ? <Banknote /> : <Lock />}
            {cash > 0 ? `Cash received · close run` : 'Close run'}
          </Button>
        </div>
      }
    >
      {cash > 0 ? (
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-brand-gold/60 bg-brand-gold/5 p-4">
            <p className="text-muted-foreground">Cash collected from customers</p>
            <p className="text-2xl font-semibold tabular-nums">{formatMmk(cash)}</p>
          </div>
          <p className="font-medium">
            Confirm that the rider has handed over the full {formatMmk(cash)} to the office.
          </p>
          <p className="text-xs text-muted-foreground">
            This records the full amount as deposited and closes the run. The rider&rsquo;s pay
            for the run is not taken out of this cash — it is kept as earnings and paid at the
            monthly settlement.
          </p>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="font-medium">No cash collected. Confirm closing run.</p>
          <p className="text-xs text-muted-foreground">
            Every parcel on this run was prepaid or paid by KBZPay. The rider&rsquo;s pay is kept as
            earnings for the monthly settlement.
          </p>
        </div>
      )}
    </Overlay>
  )
}
