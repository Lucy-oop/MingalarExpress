import { BrandMark } from '@/components/shared/brand-mark'
import { formatDateTimeYangon, formatMmk } from '@/lib/utils'
import {
  CATEGORY_LABEL,
  PAYSLIP_METHOD_LABEL,
  isPayslipMethod,
  monthLabel,
  variablePay,
  type AdjustmentCategory,
} from '@/lib/payroll/payroll'
import type { PayslipWithName } from '@/lib/payroll/queries'

type Locale = 'en' | 'my'

/**
 * One monthly payslip, the formal statement (0057). Shared by the admin page
 * and the rider app, and laid out for printing -- "Save as PDF" from the
 * browser's print dialog is the download.
 *
 * Takes the locale as a STRING, not a translator (a function cannot cross the
 * server/client boundary; see dictionary.test.ts). Labels are local because a
 * payslip is a document with its own fixed wording in both languages.
 */
const L = {
  title: { en: 'Payslip', my: 'လစာ ပြေစာ' },
  rider: { en: 'Rider', my: 'ရိုက်ဒါ' },
  period: { en: 'Pay period', my: 'လစာ ကာလ' },
  base: { en: 'Base salary', my: 'အခြေခံ လစာ' },
  prorated: { en: 'days of', my: 'ရက် / စုစုပေါင်း' },
  tripPay: { en: 'Run pay', my: 'ခရီးစဉ်ခ' },
  parcelPay: { en: 'Parcel pay', my: 'ပါဆယ်ခ' },
  pickupPay: { en: 'Pickup pay', my: 'ပါဆယ်ယူခ' },
  variable: { en: 'Variable delivery earnings', my: 'ပို့ဆောင်မှု ဝင်ငွေ' },
  bonuses: { en: 'Bonuses', my: 'ဆုငွေ' },
  deductions: { en: 'Deductions', my: 'နုတ်ငွေ' },
  net: { en: 'Net pay', my: 'အသားတင် လစာ' },
  itemised: { en: 'Adjustments', my: 'ပြင်ဆင်ချက်များ' },
  paid: { en: 'Paid', my: 'ပေးပြီး' },
  unpaid: { en: 'Not paid yet', my: 'မပေးရသေး' },
  method: { en: 'Method', my: 'နည်းလမ်း' },
  reference: { en: 'Reference', my: 'အမှတ်' },
  lockedNote: {
    en: 'This payslip is final. Any correction is made as an adjustment on a later month.',
    my: 'ဤပြေစာသည် အတည်ဖြစ်ပါသည်။ ပြင်ဆင်ချက်များကို နောက်လတွင် ထည့်ပါမည်။',
  },
} as const

type BreakdownItem = { amount: number; category: string | null; memo: string | null; booked: string }

export function PayslipView({ payslip: p, locale }: { payslip: PayslipWithName; locale: Locale }) {
  const tx = (k: keyof typeof L) => L[k][locale]
  const items = (Array.isArray(p.breakdown) ? p.breakdown : []) as unknown as BreakdownItem[]

  return (
    <article className="mx-auto max-w-2xl space-y-5 rounded-lg border bg-card p-6 print:border-0 print:p-0">
      <header className="flex items-start justify-between gap-4 border-b pb-4">
        <BrandMark tagline={false} />
        <div className="text-right">
          <p className="text-lg font-semibold">{tx('title')}</p>
          <p className="text-sm text-muted-foreground">{monthLabel(p.month)}</p>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{tx('rider')}</dt>
          <dd className="font-medium">{p.full_name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{tx('period')}</dt>
          <dd className="font-medium">{monthLabel(p.month)}</dd>
        </div>
      </dl>

      <table className="w-full text-sm">
        <tbody className="divide-y">
          <Line
            label={tx('base')}
            sub={
              p.base_days < p.days_in_month && p.base_salary > 0
                ? `${formatMmk(p.base_salary)} × ${p.base_days} ${tx('prorated')} ${p.days_in_month}`
                : undefined
            }
            value={p.base_paid}
          />
          <Line label={tx('tripPay')} value={p.trip_pay} indent />
          <Line label={tx('parcelPay')} value={p.parcel_pay} indent />
          <Line label={tx('pickupPay')} value={p.pickup_pay} indent />
          <Line label={tx('variable')} value={variablePay(p)} />
          <Line label={tx('bonuses')} value={p.bonuses} />
          <Line label={tx('deductions')} value={-p.deductions} />
          <tr className="border-t-2">
            <td className="py-2 font-semibold">{tx('net')}</td>
            <td className="py-2 text-right text-lg font-semibold tabular-nums">{formatMmk(p.net)}</td>
          </tr>
        </tbody>
      </table>

      {items.length > 0 ? (
        <section className="space-y-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {tx('itemised')}
          </h2>
          <ul className="divide-y rounded-md border text-sm">
            {items.map((it, i) => (
              <li key={i} className="flex justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium">
                    {it.category && it.category in CATEGORY_LABEL
                      ? CATEGORY_LABEL[it.category as AdjustmentCategory][locale]
                      : '—'}
                  </span>
                  {it.memo ? <span className="block text-xs text-muted-foreground">{it.memo}</span> : null}
                </span>
                {/* Ledger sign: positive = deducted from the rider. */}
                <span className="shrink-0 tabular-nums">{formatMmk(-Number(it.amount))}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="space-y-1 border-t pt-3 text-sm">
        {p.status === 'paid' ? (
          <>
            <p className="font-medium text-emerald-700">
              {tx('paid')} · {p.paid_at ? formatDateTimeYangon(p.paid_at) : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              {tx('method')}:{' '}
              {p.method && isPayslipMethod(p.method) ? PAYSLIP_METHOD_LABEL[p.method][locale] : p.method}
              {p.reference ? ` · ${tx('reference')}: ${p.reference}` : ''}
            </p>
          </>
        ) : (
          <p className="font-medium text-amber-700">{tx('unpaid')}</p>
        )}
        <p className="text-xs text-muted-foreground">{tx('lockedNote')}</p>
      </footer>
    </article>
  )
}

function Line({ label, sub, value, indent }: { label: string; sub?: string; value: number; indent?: boolean }) {
  return (
    <tr>
      <td className={indent ? 'py-1.5 pl-4 text-muted-foreground' : 'py-1.5'}>
        {label}
        {sub ? <span className="block text-xs text-muted-foreground">{sub}</span> : null}
      </td>
      <td className={indent ? 'py-1.5 text-right tabular-nums text-muted-foreground' : 'py-1.5 text-right tabular-nums'}>
        {formatMmk(value)}
      </td>
    </tr>
  )
}
