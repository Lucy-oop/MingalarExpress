import type { Database } from './database.types'

// ---------------------------------------------------------------------------
// Aliases over the generated schema. Import these, not the deep generic paths --
// when a column changes, `npm run db:types` propagates it here for free.
// ---------------------------------------------------------------------------

export type Tables = Database['public']['Tables']
export type Enums = Database['public']['Enums']
export type Functions = Database['public']['Functions']

export type UserRole = Enums['user_role']
export type OrderStatus = Enums['order_status']
export type PaymentMethod = Enums['payment_method']
export type CodStatus = Enums['cod_status']
export type RiderAvailability = Enums['rider_availability']
export type SettlementStatus = Enums['settlement_status']
export type LedgerKind = Enums['ledger_kind']
export type OfferResponse = Enums['offer_response']

export type Profile = Tables['profiles']['Row']
export type Shop = Tables['shops']['Row']
export type RiderProfile = Tables['rider_profiles']['Row']
export type Order = Tables['orders']['Row']
export type OrderInsert = Tables['orders']['Insert']
export type OrderStatusEvent = Tables['order_status_events']['Row']
export type ServiceArea = Tables['service_areas']['Row']
export type AppSettings = Tables['app_settings']['Row']
export type CodLedgerEntry = Tables['cod_ledger']['Row']
export type Settlement = Tables['settlements']['Row']

/** Row shape returned by the `cod_positions` RPC — the audit explorer's view. */
export type CodPositionRow = Functions['cod_positions']['Returns'][number]

/** Trip pay preview from `quote_trip_pay`, typed as Json in the schema. */
export type TripPayQuoteRow = {
  parcels: number
  pickups: number
  parcel_rate: number
  pickup_rate: number
  tier: { id: string; route_id: string | null; min_parcels: number; max_parcels: number | null; base_pay: number } | null
  base_pay: number
  parcel_pay: number
  pickup_pay: number
  total: number
}

/** Payload shape of the public `track_order` RPC (typed as Json in the schema). */
export type TrackedOrder = {
  code: string
  status: OrderStatus
  shop_name: string
  dropoff_area: string | null
  is_cod: boolean
  created_at: string
  picked_up_at: string | null
  delivered_at: string | null
  /**
   * 0046. An object path in the PRIVATE `delivery-proofs` bucket, present only
   * on a delivered parcel — never a URL, and never sent to the browser. The
   * tracking page signs it server-side; see that file's docblock for why this
   * one field was added to an otherwise deliberately narrow public payload.
   */
  proof_photo_path: string | null
  timeline: Array<{ status: OrderStatus; at: string }>
}

/** Whole MMK. There is no subunit; never introduce a float here. */
export type Mmk = number

export type LatLng = { lat: number; lng: number }

// ---------------------------------------------------------------------------
// Status presentation — single source of truth. Never inline these strings.
// ---------------------------------------------------------------------------

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  picked_up: 'Picked up',
  delivered: 'Delivered',
  failed: 'Failed',
  cancelled: 'Cancelled',
  returned: 'Returned to shop',
}

export const ORDER_STATUS_LABEL_MM: Record<OrderStatus, string> = {
  pending: 'စောင့်ဆိုင်းဆဲ',
  assigned: 'တာဝန်ပေးထား',
  picked_up: 'ပစ္စည်းယူပြီး',
  delivered: 'ပို့ဆောင်ပြီး',
  failed: 'မအောင်မြင်',
  cancelled: 'ပယ်ဖျက်ပြီး',
  returned: 'ဆိုင်သို့ ပြန်ပို့ပြီး',
}

/** The happy-path checkpoint sequence, for timeline rendering. */
export const ORDER_CHECKPOINTS: readonly OrderStatus[] = [
  'pending',
  'assigned',
  'picked_up',
  'delivered',
] as const

export const TERMINAL_STATUSES: readonly OrderStatus[] = ['delivered', 'cancelled'] as const

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}
