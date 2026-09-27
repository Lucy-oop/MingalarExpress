import { NextResponse, type NextRequest } from 'next/server'
import { assertRole } from '@/lib/auth/guards'
import { getPayrollMonth } from '@/lib/payroll/queries'
import { parseMonth, variablePay } from '@/lib/payroll/payroll'
import { toCsv } from '@/lib/orders/csv'

/** One month's payslips as CSV, for the bank upload or the accountant. */
const HEADERS = [
  'Rider',
  'Month',
  'Base salary',
  'Base days',
  'Base paid',
  'Run pay',
  'Parcel pay',
  'Pickup pay',
  'Variable total',
  'Bonuses',
  'Deductions',
  'Net',
  'Status',
  'Paid at',
  'Method',
  'Reference',
]

export async function GET(request: NextRequest) {
  try {
    await assertRole('super_admin')
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const month = parseMonth(request.nextUrl.searchParams.get('month'))
  if (!month) return NextResponse.json({ error: 'month_required' }, { status: 400 })

  const data = await getPayrollMonth(month)
  if (!data.locked) return NextResponse.json({ error: 'month_not_locked' }, { status: 409 })

  const csv = toCsv(
    HEADERS,
    data.payslips.map((p) => [
      p.full_name,
      month.slice(0, 7),
      String(p.base_salary),
      `${p.base_days}/${p.days_in_month}`,
      String(p.base_paid),
      String(p.trip_pay),
      String(p.parcel_pay),
      String(p.pickup_pay),
      String(variablePay(p)),
      String(p.bonuses),
      String(p.deductions),
      String(p.net),
      p.status,
      p.paid_at ?? '',
      p.method ?? '',
      p.reference ?? '',
    ]),
  )
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="payroll-${month.slice(0, 7)}.csv"`,
    },
  })
}
