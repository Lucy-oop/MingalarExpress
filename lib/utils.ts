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
  return `${new Intl.NumberFormat('en-US').format(Math.round(amount))} Ks`
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
