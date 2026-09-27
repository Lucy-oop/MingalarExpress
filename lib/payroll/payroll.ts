/**
 * Rider monthly payroll (0057): months, categories, methods and the payslip
 * arithmetic, shared by the admin page, the rider app and their tests.
 *
 * PURE. The database is the authority -- payroll_preview computes, and the
 * `payslips_net_adds_up` constraint enforces, the same sum as `payslipNet`.
 */

/** A pay month as the database stores it: the first day, 'YYYY-MM-01'. */
export type PayMonth = string

/** 'YYYY-MM' or 'YYYY-MM-DD' -> 'YYYY-MM-01', or null when it is not a month. */
export function parseMonth(raw: string | null | undefined): PayMonth | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(raw ?? '')
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return `${m[1]}-${m[2]}-01`
}

/** The month containing a Yangon calendar date ('YYYY-MM-DD'). */
export function monthOf(date: string): PayMonth {
  return `${date.slice(0, 7)}-01`
}

export function shiftMonth(month: PayMonth, by: number): PayMonth {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const total = y * 12 + (m - 1) + by
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

/** A month can be locked from the day after it ends. */
export function monthHasEnded(month: PayMonth, today: string): boolean {
  return shiftMonth(month, 1) <= today
}

const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "September 2026". */
export function monthLabel(month: PayMonth): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return `${EN_MONTHS[m - 1]} ${y}`
}

/** Matches cod_ledger_category_known. */
export const ADJUSTMENT_CATEGORIES = ['shortfall', 'equipment', 'penalty', 'advance', 'bonus', 'other'] as const
export type AdjustmentCategory = (typeof ADJUSTMENT_CATEGORIES)[number]

export const CATEGORY_LABEL: Record<AdjustmentCategory, { en: string; my: string }> = {
  shortfall: { en: 'Cash shortfall', my: 'ငွေလိုငွေ' },
  equipment: { en: 'Equipment advance', my: 'ပစ္စည်း ကြိုငွေ' },
  penalty: { en: 'Penalty', my: 'ဒဏ်ငွေ' },
  advance: { en: 'Salary advance', my: 'လစာ ကြိုထုတ်' },
  bonus: { en: 'Bonus', my: 'ဆုငွေ' },
  other: { en: 'Other', my: 'အခြား' },
}

/** Matches payslips_method_known. */
export const PAYSLIP_METHODS = ['bank', 'cash', 'kbzpay', 'cbpay', 'wavepay', 'ayapay'] as const
export type PayslipMethod = (typeof PAYSLIP_METHODS)[number]

export const PAYSLIP_METHOD_LABEL: Record<PayslipMethod, { en: string; my: string }> = {
  bank: { en: 'Bank transfer', my: 'ဘဏ်လွှဲ' },
  cash: { en: 'Cash', my: 'ငွေသား' },
  kbzpay: { en: 'KBZPay', my: 'KBZPay' },
  cbpay: { en: 'CB Pay', my: 'CB Pay' },
  wavepay: { en: 'WavePay', my: 'WavePay' },
  ayapay: { en: 'AYA Pay', my: 'AYA Pay' },
}

export function isPayslipMethod(v: unknown): v is PayslipMethod {
  return typeof v === 'string' && (PAYSLIP_METHODS as readonly string[]).includes(v)
}

export type PayslipFigures = {
  base_paid: number
  trip_pay: number
  parcel_pay: number
  pickup_pay: number
  bonuses: number
  deductions: number
}

/** Base + variable + bonuses - deductions. The same sum payslips_net_adds_up enforces. */
export function payslipNet(p: PayslipFigures): number {
  return p.base_paid + p.trip_pay + p.parcel_pay + p.pickup_pay + p.bonuses - p.deductions
}

/** Run pay + parcel pay + pickup pay: the "variable delivery earnings" line. */
export function variablePay(p: Pick<PayslipFigures, 'trip_pay' | 'parcel_pay' | 'pickup_pay'>): number {
  return p.trip_pay + p.parcel_pay + p.pickup_pay
}
