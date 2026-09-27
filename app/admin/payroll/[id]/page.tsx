import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireAdmin } from '@/lib/auth/guards'
import { getPayslip } from '@/lib/payroll/queries'
import { PayslipView } from '@/components/payroll/payslip-view'
import { PrintButton } from '@/components/payroll/print-button'

export const metadata: Metadata = { title: 'Payslip · Admin' }

export default async function AdminPayslipPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params
  const payslip = await getPayslip(id)
  if (!payslip) notFound()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/admin/payroll?month=${payslip.month.slice(0, 7)}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to payroll
        </Link>
        <PrintButton label="Print / save PDF" />
      </div>
      <PayslipView payslip={payslip} locale="en" />
    </div>
  )
}
