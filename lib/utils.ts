import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * MMK has no subunit in practice. Format as whole kyat with thin separators and
 * never with decimals -- "2,000 Ks", not "2,000.00".
 */
export function formatMmk(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  /*
    `|| 0` NORMALISES NEGATIVE ZERO, and it is not paranoia — it shipped.

    JavaScript has a signed zero, and `Intl.NumberFormat` faithfully renders it:
    `format(-0)` is the string "-0". Way history produced one the ordinary way —
    ledger amounts are stored negative, so the pay sums flip them back with a
    leading minus, and negating the sum of an EMPTY list gives `-0`. A run that
    earned nothing printed "-0 Ks", which reads as a deduction.

    Fixed here rather than at that call site because every money figure in the
    app goes through this function, and any of them can reach zero by
    subtraction. `-0 || 0` is `0`; a real 0 is unchanged.
  */
  return `${new Intl.NumberFormat('en-US').format(Math.round(amount) || 0)} Ks`
}

/** +959791234567 -> 09 791 234 567 (how a Myanmar number is actually read). */
export function formatMyanmarPhone(phone: string | null | undefined): string {
  if (!phone) return '—'
  const digits = phone.replace(/^\+95/, '')
  if (!digits.startsWith('9')) return phone
  const rest = digits.slice(1)
  const groups = rest.replace(/(\d{3})(?=\d)/g, '$1 ')
  return `0${digits[0]} ${groups}`.trim()
}

/** Local input (09...) or E.164 -> strict +959XXXXXXXXX, or null if unusable. */
export function toE164Myanmar(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '')
  let national = digits
  if (national.startsWith('95')) national = national.slice(2)
  if (national.startsWith('0')) national = national.slice(1)
  if (!national.startsWith('9')) return null
  const candidate = `+95${national}`
  return /^\+959\d{7,9}$/.test(candidate) ? candidate : null
}

export function formatDateTimeYangon(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

export function formatDistanceKm(km: number | null | undefined): string {
  if (km === null || km === undefined) return '—'
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}
