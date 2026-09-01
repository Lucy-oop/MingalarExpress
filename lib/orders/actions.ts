'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { assertRole } from '@/lib/auth/guards'
import { orderCreateSchema } from '@/lib/validation/schemas'
import { haversineKm } from '@/lib/geo/haversine'
import { quoteFee, codCollectable } from '@/lib/pricing'

export type OrderFormState = {
  error?: string
  fieldErrors?: Record<string, string[]>
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

  const { data: settings } = await supabase
    .from('app_settings')
    .select('base_delivery_fee, per_km_fee, free_km, road_factor, rider_commission_pct')
    .eq('id', true)
    .single()

  if (!settings) return { error: 'Pricing is unavailable right now. Try again shortly.' }

  const crowKm = haversineKm(v.pickupPoint, v.dropoffPoint)
  const fee = quoteFee(crowKm, settings).total

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
      dropoff_area_id: v.dropoffAreaId ?? null,
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
    })
    .select('id, code')
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

  revalidatePath('/shop/dashboard')
  revalidatePath('/shop/orders')
  redirect(`/shop/orders/${created.id}?created=1`)
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
