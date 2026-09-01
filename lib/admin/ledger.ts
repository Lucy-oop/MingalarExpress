import type { LedgerKind } from '@/types/domain'

/**
 * Presentation for `cod_ledger.kind`. The sign convention it describes is fixed
 * by the SQL comment on `public.ledger_kind`:
 *   POSITIVE = rider owes the platform (cash collected from a customer)
 *   NEGATIVE = platform owes the rider (commission earned, cash handed in)
 */
export const LEDGER_LABEL: Record<LedgerKind, string> = {
  cod_collected: 'COD collected',
  cod_remitted: 'Cash handed in',
  commission_earned: 'Delivery commission',
  platform_fee: 'Platform fee',
  adjustment: 'Adjustment',
  trip_pay: 'Route trip pay',
}

export const LEDGER_HINT: Record<LedgerKind, string> = {
  cod_collected: 'Customer cash the rider is now holding',
  cod_remitted: 'Cash the rider handed back to the office',
  commission_earned: 'The rider’s share of the delivery fee',
  platform_fee: 'A charge booked against the rider',
  adjustment: 'A manual correction — the only way to fix the ledger',
  // Booked once per run by close_trip(), never per parcel: a route order leaves
  // the commission columns NULL precisely so these two never both appear.
  trip_pay: 'Pay for a completed route run — base, parcels and pickups',
}

/** Every kind that an admin may insert by hand (RLS `cod_insert_admin`). */
export const MANUAL_KINDS: readonly LedgerKind[] = ['cod_remitted', 'adjustment', 'platform_fee']

export const LEDGER_KINDS: readonly LedgerKind[] = [
  'cod_collected',
  'cod_remitted',
  'commission_earned',
  'trip_pay',
  'platform_fee',
  'adjustment',
]
