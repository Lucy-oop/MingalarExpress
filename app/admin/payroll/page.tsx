import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/auth/guards'
import { yangonToday } from '@/lib/admin/day'
import { getPayrollMonth, getPayrollRiders } from '@/lib/payroll/queries'
import { monthOf, parseMonth, shiftMonth } from '@/lib/payroll/payroll'
import { PageHeader } from '@/components/admin/kpi'
import { PayrollBoard } from '@/components/admin/payroll-board'
import { Alert } from '@/components/ui/alert'

export const metadata: Metadata = { title: 'Payroll · Admin' }
export const dynamic = 'force-dynamic'

/**
 * Rider monthly payroll (0057). Earnings are paid here, once per calendar
 * month; daily settlements reconcile cash only.
 *
 * Defaults to LAST month -- the one that can be locked today.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  await requireAdmin()
  const sp = await searchParams
  const today = yangonToday()
  const month = parseMonth(sp.month) ?? shiftMonth(monthOf(today), -1)

  let data
  let riders
  try {
    ;[data, riders] = await Promise.all([getPayrollMonth(month), getPayrollRiders()])
  } catch (error) {
    return (
      <Alert tone="error" title="Payroll unavailable">
        {error instanceof Error ? error.message : 'Unknown error'}
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payroll"
        description="Monthly rider pay: base salary plus run, parcel and pickup pay, less deductions. Lock a month once it ends, then record each payment."
      />
      <PayrollBoard data={data} riders={riders} today={today} />
    </div>
  )
}
