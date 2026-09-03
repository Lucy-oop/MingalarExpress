import type { Metadata } from 'next'
import { BadgeCheck } from 'lucide-react'
import { requireDispatch } from '@/lib/auth/guards'
import { getKpayQueue } from '@/lib/admin/kpay'
import { KpayCard } from '@/components/admin/kpay-card'
import { PageHeader } from '@/components/admin/kpi'
import { Alert } from '@/components/ui/alert'
import { formatMmk } from '@/lib/utils'

export const metadata: Metadata = { title: 'KBZPay · Admin' }
/** Receipt links are signed and short-lived, so this must never be cached. */
export const dynamic = 'force-dynamic'

/**
 * KBZPay transfers awaiting verification against the bank.
 *
 * The queue exists because a KPay delivery books NO rider ledger line — the
 * rider never held the money — so nothing in the nightly settlement will ever
 * notice a transfer that did not arrive. Somebody has to compare each receipt
 * to the statement, and until they do, the money is in neither place.
 */
export default async function AdminKpayPage() {
  await requireDispatch()

  let queue
  try {
    queue = await getKpayQueue()
  } catch (error) {
    return (
      <Alert tone="error" title="KBZPay queue unavailable">
        {error instanceof Error ? error.message : 'Unknown error'}
      </Alert>
    )
  }

  const total = queue.reduce((sum, o) => sum + o.codAmount, 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="KBZPay to verify"
        description="Compare each receipt with the bank statement before it counts as money in."
      />

      {queue.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <BadgeCheck className="size-8 text-emerald-600" aria-hidden="true" />
          <p className="text-sm font-medium">Nothing waiting</p>
          <p className="text-xs text-muted-foreground">
            Every KBZPay transfer has been checked off.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            <strong className="tabular-nums text-foreground">{formatMmk(total)}</strong> across{' '}
            {queue.length} transfer{queue.length === 1 ? '' : 's'}, oldest first. Until each one is
            confirmed it is in neither the rider&rsquo;s hands nor the books.
          </p>
          <div className="space-y-3">
            {queue.map((item) => (
              <KpayCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
