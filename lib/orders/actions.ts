'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { assertRole } from '@/lib/auth/guards'
import { orderCreateSchema, shopSettingsSchema } from '@/lib/validation/schemas'
import { haversineKm } from '@/lib/geo/haversine'
import { codCollectable } from '@/lib/pricing'
import { resolveAreaRoute } from '@/lib/orders/queries'

/** What the confirmation modal needs. Every money figure is the SERVER's. */
export type CreatedOrder = {
  id: string
  code: string
  customerName: string
  dropoffAddress: string
  dropoffAreaId: string | null
  paymentMethod: 'cod' | 'prepaid'
  feePayer: 'customer' | 'shop'
  deliveryFee: number
  codAmount: number
}

export type OrderFormState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  /**
   * Set once, on success. The action no longer redirects: the shop needs to see
   * the generated code and the collectable total before leaving the page, and a
   * redirect gives them no chance to read either. Navigation is now the modal's
   * job, so the form owns when it happens.
   */
  created?: CreatedOrder
}

/**
 * Service-area copy, in one place.
 *
 * Migration 0007 widened the geofence from Thingangyun to Greater Yangon for the
 * route model. Messages still naming Thingangyun told a shop that a downtown
 * address was undeliverable when the database would in fact accept it.
 */
const OUT_OF_AREA =
  'That location is outside our delivery area (Greater Yangon). Move the pin closer in.'

/**
 * Create an order.
 *
 * The delivery fee and COD total are RECOMPUTED here from the two map points and
 * the current app_settings. The browser's quote is a display convenience; a fee
 * posted from a form is user input and is never trusted.
 */
export async function createOrder(
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const ctx = await assertRole('shop_owner').catch(() => null)
  // Deliberately NOT a redirect. A redirect here throws away a long, carefully
  // typed order and lands the shop on a login page with no explanation -- which
  // is indistinguishable from the form silently eating the submission. Returning
  // an error keeps every field on screen so the order survives a re-login.
  if (!ctx) {
    return {
      error:
        'Your session has expired. Sign in again in another tab, then press Create delivery order — nothing you typed has been lost.',
    }
  }

  const supabase = await createClient()

  // The shop is resolved server-side from ownership, never taken from the form.
  const { data: shop } = await supabase
    .from('shops')
    .select('id, pickup_address, pickup_lat, pickup_lng, phone, is_active')
    .eq('owner_id', ctx.userId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) {
    return { error: 'Set up your shop and pickup point before creating orders.' }
  }

  const num = (value: FormDataEntryValue | null): number | undefined => {
    const s = typeof value === 'string' ? value.trim() : ''
    return s === '' ? undefined : Number(s)
  }
  const str = (value: FormDataEntryValue | null): string =>
    typeof value === 'string' ? value : ''

  const parsed = orderCreateSchema.safeParse({
    shopId: shop.id,
    pickupAddress: str(formData.get('pickupAddress')) || shop.pickup_address,
    pickupPoint: {
      lat: num(formData.get('pickupLat')) ?? shop.pickup_lat,
      lng: num(formData.get('pickupLng')) ?? shop.pickup_lng,
    },
    pickupContact: str(formData.get('pickupContact')),
    pickupNote: str(formData.get('pickupNote')),

    customerName: str(formData.get('customerName')),
    customerPhone: str(formData.get('customerPhone')),
    customerPhoneAlt: str(formData.get('customerPhoneAlt')),
    dropoffAddress: str(formData.get('dropoffAddress')),
    dropoffAreaId: str(formData.get('dropoffAreaId')) || null,
    dropoffPoint: {
      lat: num(formData.get('dropoffLat')),
      lng: num(formData.get('dropoffLng')),
    },
    dropoffNote: str(formData.get('dropoffNote')),

    parcelDesc: str(formData.get('parcelDesc')),
    parcelWeightG: num(formData.get('parcelWeightG')) ?? null,
    parcelValue: num(formData.get('parcelValue')) ?? null,
    isFragile: formData.get('isFragile') === 'on',

    paymentMethod: str(formData.get('paymentMethod')),
    // For COD the shop enters the GOODS value; the collectable total is derived
    // below so it always matches the fee we actually charge.
    codAmount: num(formData.get('goodsValue')) ?? 0,
    deliveryFee: 0, // placeholder — replaced by the server-side quote
    feePayer: str(formData.get('feePayer')) || 'customer',
  })

  if (!parsed.success) {
    // A summary alongside the field errors, always. Several schema keys
    // (pickupPoint, dropoffPoint, paymentMethod, feePayer...) have no text input
    // to attach a message to, so a fieldErrors-only response renders as nothing
    // at all and the submission appears to vanish.
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>
    const count = Object.keys(fieldErrors).length
    return {
      error:
        count === 0
          ? 'Could not create the order. Check the details and try again.'
          : `Please fix ${count} field${count === 1 ? '' : 's'} below before submitting.`,
      fieldErrors,
    }
  }
  const v = parsed.data

  // THE PRICE.
  //
  // Flat, per route, from `routes.per_parcel_fee` — the schedule the business
  // signed off. It replaced distance quoting, which had survived the route
  // migration and was charging a Mingaladon parcel 8,100 Ks against an official
  // 4,000. The browser shows the same number from `getAreaRoutes()`, but this is
  // the one that gets stored: a fee posted from a form is user input.
  const route = await resolveAreaRoute(v.dropoffAreaId)
  if (!route) {
    return {
      error: 'We do not deliver to that area yet.',
      fieldErrors: {
        dropoffAreaId: ['No route serves this area, so the parcel cannot be priced or dispatched.'],
      },
    }
  }
  const fee = route.fee

  // Kept as information, not as a price. A shop still finds "how far is this"
  // useful, and dispatch uses it when ordering stops.
  const crowKm = haversineKm(v.pickupPoint, v.dropoffPoint)

  const goodsValue = v.paymentMethod === 'cod' ? v.codAmount : 0
  const codTotal = v.paymentMethod === 'cod' ? codCollectable(goodsValue, fee, v.feePayer) : 0

  const { data: created, error } = await supabase
    .from('orders')
    .insert({
      shop_id: v.shopId,
      created_by: ctx.userId,
      status: 'pending',

      pickup_address: v.pickupAddress,
      pickup_lat: v.pickupPoint.lat,
      pickup_lng: v.pickupPoint.lng,
      pickup_contact: v.pickupContact || shop.phone,
      pickup_note: v.pickupNote || null,

      customer_name: v.customerName,
      customer_phone: v.customerPhone,
      customer_phone_alt: v.customerPhoneAlt ?? null,
      dropoff_address: v.dropoffAddress,
      dropoff_area_id: v.dropoffAreaId,
      dropoff_lat: v.dropoffPoint.lat,
      dropoff_lng: v.dropoffPoint.lng,
      dropoff_note: v.dropoffNote || null,

      parcel_desc: v.parcelDesc,
      parcel_weight_g: v.parcelWeightG ?? null,
      parcel_value: v.parcelValue ?? null,
      is_fragile: v.isFragile,

      payment_method: v.paymentMethod,
      cod_amount: codTotal,
      delivery_fee: fee,
      fee_payer: v.feePayer,
      route_distance_km: Math.round(crowKm * 100) / 100,
      // Snapshot, for the same reason the commission split is one (D5): a later
      // remap of route_areas must not change the answer to "what was this shop
      // charged, and why".
      route_id: route.routeId,
    })
    .select(
      'id, code, customer_name, dropoff_address, dropoff_area_id, payment_method, fee_payer, delivery_fee, cod_amount',
    )
    .single()

  if (error) {
    // Translate the DB's own invariants back into field-level messages. Those
    // constraints are the authority; this mapping only makes them legible.
    //
    // Every branch below sets a top-level `error` as well as any field error.
    // A fieldErrors-only response is invisible whenever the key has no rendered
    // input, and an invisible failure reads to the shop as the form losing their
    // order -- the exact bug this mapping is supposed to prevent.
    if (error.message.includes('orders_dropoff_in_service_area')) {
      return {
        error: 'The delivery pin is outside the area we cover.',
        fieldErrors: { dropoffAddress: [OUT_OF_AREA] },
      }
    }
    if (error.message.includes('orders_pickup_in_service_area')) {
      return {
        error: 'The pickup pin is outside the area we cover.',
        fieldErrors: { pickupAddress: [OUT_OF_AREA] },
      }
    }
    if (error.message.includes('orders_cod_consistent')) {
      return {
        error: 'A cash-on-delivery order needs a collection amount.',
        fieldErrors: { codAmount: ['A COD order needs an amount above zero.'] },
      }
    }
    if (error.message.includes('row-level security') || error.code === '42501') {
      return { error: 'This shop is not active, so it cannot take new orders. Contact the office.' }
    }
    return { error: 'Could not create the order. Check the details and try again.' }
  }

  // Both dashboards, because one insert changes both: the shop's "Open
  // deliveries" bucket and the dispatcher's unrouted-parcel pool. The dispatcher
  // board is force-dynamic so this only matters for a client already holding a
  // cached RSC payload -- Realtime (route-board.tsx) is what makes it live.
  revalidatePath('/shop/dashboard')
  revalidatePath('/shop/orders')
  revalidatePath(`/shop/orders/${created.id}`)
  revalidatePath('/admin/dispatcher')

  return {
    created: {
      id: created.id,
      code: created.code,
      customerName: created.customer_name,
      dropoffAddress: created.dropoff_address,
      dropoffAreaId: created.dropoff_area_id,
      paymentMethod: created.payment_method as 'cod' | 'prepaid',
      feePayer: created.fee_payer as 'customer' | 'shop',
      deliveryFee: created.delivery_fee,
      codAmount: created.cod_amount,
    },
  }
}

/** A shop may cancel only while the order is still pending — RLS enforces it. */
export async function cancelOrder(orderId: string, reason: string) {
  const ctx = await assertRole('shop_owner').catch(() => null)
  if (!ctx) redirect('/auth/login')

  const supabase = await createClient()
  const { error } = await supabase
    .from('orders')
    .update({ status: 'cancelled', cancel_reason: reason || 'Cancelled by shop' })
    .eq('id', orderId)
    .eq('status', 'pending')

  if (error) return { error: 'This order can no longer be cancelled.' }

  revalidatePath('/shop/orders')
  revalidatePath(`/shop/orders/${orderId}`)
  return { ok: true as const }
}

// ---------------------------------------------------------------------------
// Shop profile
// ---------------------------------------------------------------------------

export type ShopSettingsState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string[]>
}

/**
 * Let a shop maintain its own pickup point and contact details.
 *
 * `shops_owner_all` has granted the owner full control of their own row since
 * migration 0003; the app simply never offered a way to use it, so every change
 * — a new phone number, a moved shopfront — needed a call to the office. The
 * write is still RLS-scoped, so this cannot touch another shop.
 *
 * `is_active` is deliberately NOT editable here: suspension is an office
 * decision, and a suspended shop reactivating itself would defeat the point.
 */
export async function updateShopSettings(
  _prev: ShopSettingsState,
  formData: FormData,
): Promise<ShopSettingsState> {
  const ctx = await assertRole('shop_owner').catch(() => null)
  if (!ctx) {
    return { error: 'Your session has expired. Sign in again and retry — nothing has been saved.' }
  }

  const parsed = shopSettingsSchema.safeParse({
    name: formData.get('name'),
    phone: formData.get('phone'),
    pickupAddress: formData.get('pickupAddress'),
    pickupPoint: {
      lat: Number(formData.get('pickupLat')),
      lng: Number(formData.get('pickupLng')),
    },
    pickupNote: formData.get('pickupNote') ?? '',
  })

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>
    return {
      error: 'Check the fields below.',
      fieldErrors,
    }
  }
  const v = parsed.data

  const supabase = await createClient()
  const { error } = await supabase
    .from('shops')
    .update({
      name: v.name,
      phone: v.phone,
      pickup_address: v.pickupAddress,
      pickup_lat: v.pickupPoint.lat,
      pickup_lng: v.pickupPoint.lng,
      pickup_note: v.pickupNote || null,
    })
    .eq('owner_id', ctx.userId)

  if (error) {
    if (error.message.includes('in_service_area')) {
      return {
        error: 'That pickup point is outside our delivery area.',
        fieldErrors: { pickupAddress: ['Move the pin inside Greater Yangon.'] },
      }
    }
    return { error: 'Could not save your shop details. Try again.' }
  }

  revalidatePath('/shop/settings')
  revalidatePath('/shop/dashboard')
  // The pickup point pre-fills every new order, so a stale copy would send the
  // next rider to the old address.
  revalidatePath('/shop/orders/new')
  return { ok: true }
}
