import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRider } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { getPayslip } from '@/lib/payroll/queries'
import { PayslipView } from '@/components/payroll/payslip-view'
import { PrintButton } from '@/components/payroll/print-button'

export const metadata: Metadata = { title: 'Payslip' }

/** One payslip. RLS: a rider can only open their own -- another's is a 404. */
export default async function RiderPayslipPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRider()
  const locale = await getLocale()
  const t = translator(locale)
  const { id } = await params
  const payslip = await getPayslip(id)
  if (!payslip) notFound()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href="/rider/payslips"
          className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowLeft className="size-4" />
          {t('payslips.back')}
        </Link>
        <PrintButton label={t('payslips.print')} />
      </div>
      <PayslipView payslip={payslip} locale={locale} />
    </div>
  )
}
