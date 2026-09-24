'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { assertRole } from '@/lib/auth/guards'
import { resolveAreaRoute } from '@/lib/orders/queries'
import { dbId, myanmarPhone, optionalMyanmarPhone } from '@/lib/validation/schemas'
import { MAX_MMK } from '@/lib/validation/limits'
import { MIN_ADDRESS_LENGTH } from '@/lib/orders/booking'
import {
  DIRECT_SHOP,
  OUTSIDE_CHANNELS,
  outsidePayment,
  parseFeeOverride,
} from '@/lib/orders/outside-way'
import { OFFICE_PHONE } from '@/lib/contact/channels'
import { formatMmk } from '@/lib/utils'

/** What the success panel shows. Every figure is the one that was stored. */
export type OutsideCreated = {
  id: string
  code: string
  shopName: string
  customerName: string
  deliveryFee: number
  codAmount: number
  paymentMethod: 'cod' | 'prepaid'
}

export type OutsideFormState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  created?: OutsideCreated
}

const DIRECT_SHOP_NAME = 'Direct (Outside Way)'

const AMOUNT_MESSAGE: Record<string, string> = {
  amount_empty: 'Enter the amount to collect for the goods.',
  amount_not_a_number: 'The amount must be a number of kyat.',
  amount_decimal: 'Kyat has no decimals — enter a whole number.',
  amount_negative: 'The amount cannot be negative.',
  amount_too_large: 'That amount looks too large — check the value.',
}

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))

const outsideSchema = z.object({
  shop: z.union([z.literal(DIRECT_SHOP), dbId('Choose a shop, or Direct')]),
  source: z.enum(OUTSIDE_CHANNELS, { error: 'Choose where the order came from' }),
  senderName: optionalText(160),
  senderPhone: optionalMyanmarPhone.optional(),

  pickupAddress: optionalText(300),
  pickupContact: optionalText(120),

  customerName: z.string().trim().min(2, "Receiver's name is required").max(160),
  customerPhone: myanmarPhone,
  customerPhoneAlt: optionalMyanmarPhone.optional(),
  dropoffAddress: z
    .string()
    .trim()
    .min(MIN_ADDRESS_LENGTH, 'Delivery address is required')
    .max(300),
  dropoffAreaId: dbId('Choose the township'),
  routeId: z.union([z.literal(''), dbId('Invalid route')]),
  dropoffNote: optionalText(300),

  parcelDesc: optionalText(500),
  paid: z.enum(['nothing', 'product', 'all']),
  feePayer: z.enum(['customer', 'shop']),
})

/**
 * The house shop for senders with no account, created on first use.
 *
 * NOT IN THE MIGRATION because `owner_id` must name a profile and a migration
 * has no office profile to name. The first admin to book a direct parcel owns
 * it; ownership grants them nothing the office role does not already have.
 *
 * `shops_one_direct` makes two admins racing to create it harmless: the loser
 * gets a unique violation and reads the winner's row.
 */
async function directShop(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ id: string; name: string; pickup_address: string; pickup_lat: number | null; pickup_lng: number | null; phone: string } | null> {
  const columns = 'id, name, pickup_address, pickup_lat, pickup_lng, phone'
  const existing = await supabase.from('shops').select(columns).eq('is_direct', true).maybeSingle()
  if (existing.data) return existing.data

  const now = new Date().toISOString()
  const inserted = await supabase
    .from('shops')
    .insert({
      owner_id: userId,
      name: DIRECT_SHOP_NAME,
      phone: OFFICE_PHONE,
      pickup_address: 'Mingalar Express office',
      is_direct: true,
      // Reviewed by definition: it is the office's own. Without this the shop
      // would sit in the registrations worklist as a merchant awaiting review.
      approved_at: now,
      approved_by: userId,
    })
    .select(columns)
    .single()
  if (inserted.data) return inserted.data
  if (inserted.error?.code === '23505') {
    const again = await supabase.from('shops').select(columns).eq('is_direct', true).maybeSingle()
    return again.data ?? null
  }
  return null
}

/**
 * Book an Outside Way parcel on a shop's behalf.
 *
 * Unlike `createOrder`, the shop comes FROM THE FORM -- that is the whole point
 * -- which is safe because only the office reaches this: `assertRole` here,
 * `orders_all_dispatch` at the database, and `tg_orders_shop_gate` stands aside
 * for dispatch, so an unreviewed shop's COD parcel can be booked by the office
 * that reviews it.
 *
 * THE FEE IS THE OFFICE'S TO SET. Blank takes the zone price, as a shop's
 * booking does; a typed figure is stored as typed, for negotiated rates.
 */
export async function createOutsideOrder(
  _prev: OutsideFormState,
  formData: FormData,
): Promise<OutsideFormState> {
  const ctx = await assertRole('super_admin').catch(() => null)
  if (!ctx) {
    return { error: 'Your session has expired. Sign in again in another tab — nothing you typed has been lost.' }
  }

  const str = (k: string) => {
    const v = formData.get(k)
    return typeof v === 'string' ? v : ''
  }

  const parsed = outsideSchema.safeParse({
    shop: str('shop'),
    source: str('source'),
    senderName: str('senderName'),
    senderPhone: str('senderPhone'),
    pickupAddress: str('pickupAddress'),
    pickupContact: str('pickupContact'),
    customerName: str('customerName'),
    customerPhone: str('customerPhone'),
    customerPhoneAlt: str('customerPhoneAlt'),
    dropoffAddress: str('dropoffAddress'),
    dropoffAreaId: str('dropoffAreaId'),
    routeId: str('routeId'),
    dropoffNote: str('dropoffNote'),
    parcelDesc: str('parcelDesc'),
    paid: str('paid') || 'nothing',
    feePayer: str('feePayer') || 'customer',
  })

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>
    const count = Object.keys(fieldErrors).length
    return {
      error: `Please fix ${count} field${count === 1 ? '' : 's'} below.`,
      fieldErrors,
    }
  }
  const v = parsed.data
  const direct = v.shop === DIRECT_SHOP

  // A direct parcel's sender is who the office pays out to, by hand -- without
  // a name and number there is nobody to hand the COD to.
  if (direct && (!v.senderName || !v.senderPhone)) {
    return {
      error: 'A Direct parcel needs the sender, so the office knows whom to pay.',
      fieldErrors: {
        ...(v.senderName ? {} : { senderName: ["Sender's name is required for Direct"] }),
        ...(v.senderPhone ? {} : { senderPhone: ["Sender's phone is required for Direct"] }),
      },
    }
  }

  const supabase = await createClient()

  let shop
  if (direct) {
    shop = await directShop(supabase, ctx.userId)
    if (!shop) return { error: 'Could not set up the Direct shop. Try again, or contact support.' }
  } else {
    const { data } = await supabase
      .from('shops')
      .select('id, name, pickup_address, pickup_lat, pickup_lng, phone, is_active')
      .eq('id', v.shop)
      .maybeSingle()
    if (!data) return { error: 'That shop no longer exists.', fieldErrors: { shop: ['Choose another shop'] } }
    // The office can book for an unreviewed shop, but not for one it has
    // suspended or rejected: that decision is still in force.
    if (!data.is_active) {
      return {
        error: `${data.name} is suspended or rejected, so it cannot take new orders.`,
        fieldErrors: { shop: ['This shop is not trading'] },
      }
    }
    shop = data
  }

  // A Direct parcel is collected from the sender, never from the house shop's
  // placeholder address, so there is nothing to fall back to.
  const pickupAddress = v.pickupAddress || (direct ? '' : shop.pickup_address)
  if (pickupAddress.trim().length < MIN_ADDRESS_LENGTH) {
    return { error: 'Enter the pickup address.', fieldErrors: { pickupAddress: ['Pickup address is required'] } }
  }

  /*
    THE PRICE, AND THE WAY ONLY IF CHOSEN. The zone prices the area, exactly as
    in `createOrder`, and the office may type its own fee instead. The way is
    never derived from the township (0049): it is stored only when the office
    picked one here, and otherwise chosen on the board when the parcel is
    loaded onto a delivery way.
  */
  const resolved = await resolveAreaRoute(v.dropoffAreaId)
  const feeOverride = parseFeeOverride(str('deliveryFee'))
  if (!feeOverride.ok) {
    return {
      error: 'Check the delivery fee.',
      fieldErrors: { deliveryFee: [AMOUNT_MESSAGE[`amount_${feeOverride.reason}`] ?? 'Invalid fee'] },
    }
  }

  let routeId: string | null = null
  if (v.routeId) {
    const { data: route } = await supabase
      .from('routes')
      .select('id, is_active')
      .eq('id', v.routeId)
      .maybeSingle()
    if (!route || !route.is_active) {
      return { error: 'That route is not active.', fieldErrors: { routeId: ['Choose an active route'] } }
    }
    routeId = route.id
  }
  const fee = feeOverride.value ?? resolved?.fee ?? null
  if (fee === null) {
    return {
      error: 'That township has no delivery rate.',
      fieldErrors: { deliveryFee: ['Type the delivery fee, or add this township to a zone under Pricing'] },
    }
  }

  const payment = outsidePayment(v.paid, str('goodsValue'), v.feePayer, fee)
  if (!payment.ok) {
    return {
      error: 'Check the amount to collect.',
      fieldErrors: { goodsValue: [AMOUNT_MESSAGE[payment.reason] ?? 'Invalid amount'] },
    }
  }
  // "Collect the delivery fee only" with a fee of 0 is COD with nothing to
  // collect, which `orders_cod_consistent` would refuse less legibly.
  if (payment.paymentMethod === 'cod' && payment.collect < 1) {
    return {
      error: 'There is nothing for the rider to collect.',
      fieldErrors: { paid: ['With a delivery fee of 0, choose "Everything is paid"'] },
    }
  }
  if (payment.collect > MAX_MMK) {
    return {
      error: 'That collection amount is too large.',
      fieldErrors: {
        goodsValue: [`With the ${formatMmk(fee)} fee this comes to ${formatMmk(payment.collect)}, over the ${formatMmk(MAX_MMK)} limit.`],
      },
    }
  }

  const { data: created, error } = await supabase
    .from('orders')
    .insert({
      shop_id: shop.id,
      created_by: ctx.userId,
      status: 'pending',
      source: v.source,
      sender_name: direct ? v.senderName || null : null,
      sender_phone: direct ? v.senderPhone ?? null : null,

      pickup_address: pickupAddress,
      // The shop's saved pin only when the parcel leaves from the shop's saved
      // address; a typed address elsewhere would otherwise inherit a pin that
      // points at the wrong street.
      pickup_lat: v.pickupAddress ? null : shop.pickup_lat,
      pickup_lng: v.pickupAddress ? null : shop.pickup_lng,
      pickup_contact: v.pickupContact || (direct ? v.senderPhone ?? shop.phone : shop.phone),

      customer_name: v.customerName,
      customer_phone: v.customerPhone,
      customer_phone_alt: v.customerPhoneAlt ?? null,
      dropoff_address: v.dropoffAddress,
      dropoff_area_id: v.dropoffAreaId,
      dropoff_note: v.dropoffNote || null,

      parcel_desc: v.parcelDesc || 'Parcel',

      payment_method: payment.paymentMethod,
      cod_amount: payment.collect,
      delivery_fee: fee,
      fee_payer: payment.feePayer,
      route_id: routeId,
    })
    .select('id, code, customer_name, delivery_fee, cod_amount, payment_method')
    .single()

  if (error) {
    if (error.message.includes('orders_cod_consistent')) {
      return { error: 'A cash-on-delivery parcel needs an amount to collect.' }
    }
    if (error.message.includes('row-level security') || error.code === '42501') {
      return { error: 'Your account cannot book parcels. Only the office role can.' }
    }
    return { error: `Could not create the order: ${error.message}` }
  }

  revalidatePath('/admin')
  revalidatePath('/admin/orders')
  revalidatePath('/shop/dashboard')
  revalidatePath('/shop/orders')

  return {
    created: {
      id: created.id,
      code: created.code,
      shopName: direct ? `${shop.name} · ${v.senderName}` : shop.name,
      customerName: created.customer_name,
      deliveryFee: created.delivery_fee,
      codAmount: created.cod_amount,
      paymentMethod: created.payment_method as 'cod' | 'prepaid',
    },
  }
}
