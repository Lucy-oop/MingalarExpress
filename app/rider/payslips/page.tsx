import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronRight, FileText } from 'lucide-react'
import { requireRider } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { getMyPayslips } from '@/lib/payroll/queries'
import { monthLabel } from '@/lib/payroll/payroll'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { formatMmk } from '@/lib/utils'

export const metadata: Metadata = { title: 'Payslips' }
export const dynamic = 'force-dynamic'

/** The rider's finalized monthly payslips (0057). RLS returns only their own. */
export default async function RiderPayslipsPage() {
  await requireRider()
  const t = translator(await getLocale())

  let payslips
  try {
    payslips = await getMyPayslips()
  } catch (error) {
    return <Alert tone="error">{error instanceof Error ? error.message : 'Unknown error'}</Alert>
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{t('payslips.title')}</h1>
        <p className="text-xs text-muted-foreground">{t('payslips.hint')}</p>
      </div>

      {payslips.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t('payslips.empty')}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {payslips.map((p) => (
            <li key={p.id}>
              <Link
                href={`/rider/payslips/${p.id}`}
                className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-muted"
              >
                <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{monthLabel(p.month)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('payslips.net')} {formatMmk(p.net)}
                  </span>
                </span>
                {p.status === 'paid' ? (
                  <Badge tone="green">{t('payslips.paid')}</Badge>
                ) : (
                  <Badge tone="amber">{t('payslips.unpaid')}</Badge>
                )}
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
