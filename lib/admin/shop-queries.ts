import { createClient } from '@/lib/supabase/server'
import type { ShopStatus } from '@/lib/validation/admin-shop'
import type { OrderStatus } from '@/types/domain'

/**
 * Shop-side reads for the Super Admin panel.
 *
 * A note on where the money comes from. `cod_by_shop()` is the same RPC the COD
 * audit explorer uses, called here with an all-time window so the two screens
 * can never disagree. Its own migration comment is worth repeating: the shop
 * side is DERIVED FROM ORDERS, not from a ledger. `cod_ledger` is the book of
 * record for cash the platform is owed by riders; what the platform owes each
 * shop is computed. Nothing marks a shop payout as cleared, because no
 * shop-side settlement table exists.
 */

/** Wide enough to mean "all time" without special-casing a null bound. */
const EPOCH = '2000-01-01'

/**
 * Order aggregates are counted in JS from a bounded projection rather than
 * grouped in SQL.
 *
 * PostgREST cannot GROUP BY, and the alternative — a `shop_positions()` RPC —
 * needs a migration plus `npm run db:types`, and the generated types are not
 * hand-editable (README rule 6). Four narrow columns over a township's order
 * history is cheap.
 *
 * `ShopListResult.truncated` compares the server's exact count against what
 * came back, so outgrowing this assumption surfaces as a banner rather than as
 * quietly shrinking numbers.
 */
const ORDER_SCAN_LIMIT = 50_000

export type ShopListRow = {
  /** Stable React key: shops have an id, pending owners do not have a shop yet. */
  key: string
  shopId: string | null
  name: string | null
  phone: string | null
  areaId: string | null
  area: string | null
  pickupAddress: string | null
  pickupLat: number | null
  pickupLng: number | null
  pickupNote: string | null
  /** `shops.is_active`. False alone means the shop is suspended. */
  shopActive: boolean
  /** What the shop sells, from its own setup step. */
  goodsType: string | null
  /** When the office let it start trading; null means it is still waiting. */
  approvedAt: string | null
  /** `profiles.is_active` on the owner — this is what actually blocks login. */
  ownerActive: boolean
  status: ShopStatus
  /** Shop creation for a real shop; owner signup for a pending one. */
  joinedAt: string
  ownerId: string
  ownerName: string
  ownerPhone: string | null
  totalOrders: number
  pendingOrders: number
  inFlightOrders: number
  deliveredOrders: number
  cancelledOrders: number
  /** COD still on a rider for this shop's parcels — collected but not delivered. */
  codInFlight: number
  codCollected: number
  /** Derived, all-time. See the caveat at the top of this file. */
  owedToShop: number
  platformFees: number
}

export type ShopListResult = {
  rows: ShopListRow[]
  summary: {
    active: number
    suspended: number
    pending: number
    awaiting: number
    /** Sum of `owed_to_shop` over active + suspended shops. Derived, not a ledger. */
    codPendingClearance: number
    codInFlight: number
  }
  /** True when the order scan hit its ceiling and the counts are floors. */
  truncated: boolean
}

type OrderAgg = {
  total: number
  pending: number
  inFlight: number
  delivered: number
  cancelled: number
  codInFlight: number
}

const emptyAgg = (): OrderAgg => ({
  total: 0,
  pending: 0,
  inFlight: 0,
  delivered: 0,
  cancelled: 0,
  codInFlight: 0,
})

export type NewShopNotice = {
  shopId: string
  name: string | null
  ownerName: string
  ownerPhone: string | null
  goodsType: string | null
  pickupAddress: string | null
  createdAt: string
}

/**
 * Shops nobody in the office has looked at yet.
 *
 * SEPARATE FROM `getShopList` ON PURPOSE. That function is the shops PAGE: it
 * scans up to 50,000 orders to derive COD positions per shop, which is the
 * right cost for a working screen and the wrong one for a notice on a landing
 * page that renders on every visit.
 *
 * The predicate is the one 0026 defined and 0031 reinterpreted: `approved_at`
 * null with no rejection. It no longer means "cannot trade" — since 0031 these
 * shops are booking prepaid parcels right now — it means "COD is still locked
 * and a human has not seen them". That is precisely what makes the notice
 * worth acting on: every hour it sits there is an hour a real merchant cannot
 * take cash.
 */
export async function getNewShopNotices(limit = 8): Promise<NewShopNotice[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('shops')
    .select(
      `id, name, goods_type, pickup_address, created_at,
       profiles!shops_owner_id_fkey (full_name, phone)`,
    )
    .is('approved_at', null)
    .is('rejected_at', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  // A notice is chrome. If it cannot load, the page it sits on still has to.
  if (error || !data) return []

  return data.map((raw) => {
    const owner = raw.profiles as unknown as { full_name: string; phone: string | null } | null
    return {
      shopId: raw.id,
      name: raw.name,
      ownerName: owner?.full_name ?? 'Unknown owner',
      ownerPhone: owner?.phone ?? null,
      goodsType: raw.goods_type,
      pickupAddress: raw.pickup_address,
      createdAt: raw.created_at,
    }
  })
}

export async function getShopList(): Promise<ShopListResult> {
  const supabase = await createClient()

  const [
    { data: shops, error },
    { data: positions },
    { data: orders, count: orderCount },
    { data: owners },
  ] = await Promise.all([
      supabase
        .from('shops')
        .select(
          `id, owner_id, name, phone, area_id, pickup_address, pickup_lat, pickup_lng,
           pickup_note, is_active, created_at, goods_type, approved_at, rejected_at,
           profiles!shops_owner_id_fkey (full_name, phone, is_active),
           service_areas!shops_area_id_fkey (name)`,
        )
        .order('created_at', { ascending: false }),
      supabase.rpc('cod_by_shop', { p_from: EPOCH }),
      supabase
        .from('orders')
        // `count: 'exact'` is the truncation detector. Comparing the returned
        // length against ORDER_SCAN_LIMIT would miss a server-side cap --
        // PostgREST can be configured with its own `max-rows`, and silently
        // returning a page smaller than we asked for would under-count every
        // shop with no indication anything was wrong.
        .select('shop_id, status, cod_amount, payment_method', { count: 'exact' })
        .limit(ORDER_SCAN_LIMIT),
      // Every shop owner, so the ones with no shop row can be surfaced as pending.
      supabase
        .from('profiles')
        .select('id, full_name, phone, is_active, created_at')
        .eq('role', 'shop_owner')
        .order('created_at', { ascending: false }),
    ])

  if (error) throw new Error(`shops unavailable: ${error.message}`)

  const money = new Map(
    (positions ?? []).map((p) => [
      p.shop_id,
      { owed: p.owed_to_shop, collected: p.cod_collected, fees: p.platform_fees },
    ]),
  )

  const agg = new Map<string, OrderAgg>()
  for (const o of orders ?? []) {
    const bucket = agg.get(o.shop_id) ?? emptyAgg()
    bucket.total += 1
    const status = o.status as OrderStatus
    if (status === 'pending') bucket.pending += 1
    else if (status === 'assigned' || status === 'picked_up') {
      bucket.inFlight += 1
      // Cash the rider is carrying on this shop's behalf. Not yet in
      // `owed_to_shop`, which only counts delivered orders.
      if (o.payment_method === 'cod') bucket.codInFlight += o.cod_amount
    } else if (status === 'delivered') bucket.delivered += 1
    else if (status === 'cancelled' || status === 'failed') bucket.cancelled += 1
    agg.set(o.shop_id, bucket)
  }

  const rows: ShopListRow[] = (shops ?? []).map((s) => {
    const owner = s.profiles as unknown as {
      full_name: string
      phone: string | null
      is_active: boolean
    } | null
    const a = agg.get(s.id) ?? emptyAgg()
    const m = money.get(s.id)
    const ownerActive = owner?.is_active ?? false

    return {
      key: s.id,
      shopId: s.id,
      name: s.name,
      phone: s.phone,
      areaId: s.area_id,
      area: (s.service_areas as unknown as { name: string } | null)?.name ?? null,
      pickupAddress: s.pickup_address,
      pickupLat: s.pickup_lat,
      pickupLng: s.pickup_lng,
      pickupNote: s.pickup_note,
      shopActive: s.is_active,
      ownerActive,
      // A locked-out owner is a suspended shop in every way that matters, even
      // if nobody flipped `shops.is_active` — they cannot sign in to use it.
      /*
        Four states since 0026. `awaiting` and `suspended` used to be the same
        row -- "not active" -- and the office queue could not tell a shop it had
        never looked at from one it had switched off.

        A locked-out owner is a suspended shop in every way that matters, even
        if nobody flipped `shops.is_active`: they cannot sign in to use it.
      */
      /*
        Same ordering as shopApprovalState, and for the same reason: a shop
        suspended before anyone reviewed it is is_active = false with
        approved_at still null, and listing it under "Awaiting approval" would
        put it in the queue of shops to confirm rather than the list of shops
        that are switched off.
      */
      status: s.rejected_at
        ? 'suspended'
        : !(s.is_active && ownerActive)
          ? 'suspended'
          : !s.approved_at
            ? 'awaiting'
            : 'active',
      goodsType: s.goods_type ?? null,
      approvedAt: s.approved_at ?? null,
      joinedAt: s.created_at,
      ownerId: s.owner_id,
      ownerName: owner?.full_name ?? 'Unknown owner',
      ownerPhone: owner?.phone ?? null,
      totalOrders: a.total,
      pendingOrders: a.pending,
      inFlightOrders: a.inFlight,
      deliveredOrders: a.delivered,
      cancelledOrders: a.cancelled,
      codInFlight: a.codInFlight,
      codCollected: m?.collected ?? 0,
      owedToShop: m?.owed ?? 0,
      platformFees: m?.fees ?? 0,
    }
  })

  /**
   * Owners with no shop row. Public signup creates the auth user and the
   * profile; nothing has ever created the shop, which is why /shop/settings
   * tells them to ring the office. They belong in this list — invisible
   * signups are signups nobody onboards.
   */
  const owned = new Set(rows.map((r) => r.ownerId))
  for (const o of owners ?? []) {
    if (owned.has(o.id)) continue
    rows.push({
      key: `owner:${o.id}`,
      shopId: null,
      name: null,
      phone: null,
      areaId: null,
      area: null,
      pickupAddress: null,
      pickupLat: null,
      pickupLng: null,
      pickupNote: null,
      shopActive: false,
      ownerActive: o.is_active,
      status: 'pending',
      goodsType: null,
      approvedAt: null,
      joinedAt: o.created_at,
      ownerId: o.id,
      ownerName: o.full_name,
      ownerPhone: o.phone,
      totalOrders: 0,
      pendingOrders: 0,
      inFlightOrders: 0,
      deliveredOrders: 0,
      cancelledOrders: 0,
      codInFlight: 0,
      codCollected: 0,
      owedToShop: 0,
      platformFees: 0,
    })
  }

  rows.sort((a, b) => b.joinedAt.localeCompare(a.joinedAt))

  return {
    rows,
    summary: {
      active: rows.filter((r) => r.status === 'active').length,
      suspended: rows.filter((r) => r.status === 'suspended').length,
      awaiting: rows.filter((r) => r.status === 'awaiting').length,
      pending: rows.filter((r) => r.status === 'pending').length,
      codPendingClearance: rows.reduce((n, r) => n + r.owedToShop, 0),
      codInFlight: rows.reduce((n, r) => n + r.codInFlight, 0),
    },
    truncated: (orderCount ?? 0) > (orders ?? []).length,
  }
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type ShopRecentOrder = {
  id: string
  code: string
  status: OrderStatus
  customer_name: string
  cod_amount: number
  delivery_fee: number
  payment_method: 'cod' | 'prepaid'
  created_at: string
  delivered_at: string | null
}

export type ShopAuditEntry = {
  id: number
  action: string
  actor_name: string | null
  created_at: string
  reason: string | null
  detail: string | null
}

export type ShopDetail = {
  shop: {
    id: string
    name: string
    phone: string
    areaId: string | null
    area: string | null
    pickupAddress: string
    /** Null when nobody has established the pin yet — see 0034. */
    pickupLat: number | null
    pickupLng: number | null
    pickupNote: string | null
    isActive: boolean
    createdAt: string
  }
  owner: { id: string; fullName: string; phone: string | null; isActive: boolean } | null
  orders: ShopRecentOrder[]
  /** Admin action trail for this shop, newest first. */
  notes: ShopAuditEntry[]
}

export async function getShopDetail(shopId: string): Promise<ShopDetail | null> {
  const supabase = await createClient()

  const { data: shop } = await supabase
    .from('shops')
    .select(
      `id, owner_id, name, phone, area_id, pickup_address, pickup_lat, pickup_lng,
       pickup_note, is_active, created_at,
       service_areas!shops_area_id_fkey (name)`,
    )
    .eq('id', shopId)
    .maybeSingle()

  if (!shop) return null

  const [{ data: owner }, { data: orders }, { data: audit }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, phone, is_active')
      .eq('id', shop.owner_id)
      .maybeSingle(),
    supabase
      .from('orders')
      .select(
        'id, code, status, customer_name, cod_amount, delivery_fee, payment_method, created_at, delivered_at',
      )
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(10),
    /**
     * There is no `shops.notes` column, and adding one would need a migration.
     * The audit log is the honest source for "what has the office done to this
     * shop and why" — every suspend, activate and onboard writes its reason
     * here, attributed to the admin who did it.
     */
    supabase
      .from('audit_log')
      .select('id, action, actor_id, before, after, created_at')
      .eq('entity_table', 'shops')
      .eq('entity_id', shopId)
      .order('created_at', { ascending: false })
      .limit(25),
  ])

  const actorIds = [
    ...new Set((audit ?? []).map((a) => a.actor_id).filter((id): id is string => !!id)),
  ]
  const actorNames = new Map<string, string>()
  if (actorIds.length > 0) {
    const { data: actors } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', actorIds)
    for (const a of actors ?? []) actorNames.set(a.id, a.full_name)
  }

  return {
    shop: {
      id: shop.id,
      name: shop.name,
      phone: shop.phone,
      areaId: shop.area_id,
      area: (shop.service_areas as unknown as { name: string } | null)?.name ?? null,
      pickupAddress: shop.pickup_address,
      pickupLat: shop.pickup_lat,
      pickupLng: shop.pickup_lng,
      pickupNote: shop.pickup_note,
      isActive: shop.is_active,
      createdAt: shop.created_at,
    },
    owner: owner
      ? {
          id: owner.id,
          fullName: owner.full_name,
          phone: owner.phone,
          isActive: owner.is_active,
        }
      : null,
    orders: (orders ?? []) as ShopRecentOrder[],
    notes: (audit ?? []).map((a) => {
      const after = (a.after ?? {}) as Record<string, unknown>
      return {
        id: a.id,
        action: a.action,
        actor_name: a.actor_id ? (actorNames.get(a.actor_id) ?? null) : null,
        created_at: a.created_at,
        reason: typeof after.reason === 'string' ? after.reason : null,
        detail: typeof after.detail === 'string' ? after.detail : null,
      }
    }),
  }
}
