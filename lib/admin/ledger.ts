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
  pickup_pay: 'Collection pay',
}

export const LEDGER_HINT: Record<LedgerKind, string> = {
  cod_collected: 'Customer cash the rider is now holding',
  cod_remitted: 'Cash the rider handed back to the office',
  commission_earned: 'The rider’s share of the delivery fee',
  platform_fee: 'A charge booked against the rider',
  adjustment: 'A manual correction — the only way to fix the ledger',
  /*
    0042 SPLIT THESE THREE BY PAY MODEL, and the old comment here was the
    thing that became false:

      pay_model 'trip'         one trip_pay line per run, commission NULL
      pay_model 'per_parcel'   a pickup_pay per collection and a
                               commission_earned per delivery, no trip_pay

    So trip_pay and the per-parcel pair still never appear on the same run —
    the reason has moved from "a route order leaves the columns NULL" to
    "close_trip skips the per-run line on a per_parcel route".
  */
  trip_pay: 'Pay for a completed route run — base, parcels and pickups',
  pickup_pay: 'Pay for collecting one parcel from a shop',
}

/** Every kind that an admin may insert by hand (RLS `cod_insert_admin`). */
export const MANUAL_KINDS: readonly LedgerKind[] = ['cod_remitted', 'adjustment', 'platform_fee']

export const LEDGER_KINDS: readonly LedgerKind[] = [
  'cod_collected',
  'cod_remitted',
  'commission_earned',
  'pickup_pay',
  'trip_pay',
  'platform_fee',
  'adjustment',
]
