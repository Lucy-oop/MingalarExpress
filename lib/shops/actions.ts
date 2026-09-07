'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireShop } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { forwardGeocode } from '@/lib/map/geocoder'
import { servicePoint, shopSetupSchema } from '@/lib/validation/schemas'

export type ShopSetupResult =
  | { ok: true }
  | { ok: false; message?: string; fieldErrors?: Record<string, string[]> }

/**
 * The shop describes itself into existence and starts trading.
 *
 * NOT "PENDING" ANY MORE. 0031 moved approval off trade and onto cash: this
 * insert leaves `approved_at` null, and that now means "can book prepaid, COD
 * locked" rather than "wait for a phone call". Which is why the form says Save
 * and not Send for confirmation -- there is nothing to wait for.
 *
 * INSERTED UNDER THE OWNER'S OWN SESSION, not the service role. `shops_owner_all`
 * permits `owner_id = auth.uid()`, and `tg_shops_guard` (0026) forces
 * `approved_at` null however the request is shaped -- so the office never types
 * an address, and a shop still cannot wave itself through. That pairing is the
 * whole design; using the service role here would throw away the second half.
 *
 * THE COORDINATES ARE NOT TYPED, AND NOT REQUIRED. Two honest sources -- the
 * owner's device tapped in the shop, or a lookup of the address they typed --
 * and when neither answers, null. 0034 made that legal precisely so this screen
 * cannot turn anyone away.
 *
 * The pin is not optional forever, only at registration. `orders.pickup_lat/lng`
 * are still NOT NULL, because they are the rider's navigation target and there
 * is no honest default for those either -- so a pinless shop can sign in, be
 * seen by the office and set its own pin in Shop settings, but cannot book a
 * parcel until it has one. The block moved from the first screen a merchant ever
 * sees to one they reach with an account and a fixable prompt.
 */
export async function setUpShop(
  _prev: ShopSetupResult,
  formData: FormData,
): Promise<ShopSetupResult> {
  const { userId } = await requireShop()

  const parsed = shopSetupSchema.safeParse({
    name: formData.get('name'),
    goodsType: formData.get('goodsType'),
    phone: formData.get('phone'),
    pickupAddress: formData.get('pickupAddress'),
    pickupNote: formData.get('pickupNote') ?? '',
    // The hidden pair is empty until the owner taps for their location, and an
    // empty string coerces to 0 -- which is a real coordinate, in the Gulf of
    // Guinea. `|| undefined` is what keeps it out of `resolvePoint`.
    pickupLat: formData.get('pickupLat') || undefined,
    pickupLng: formData.get('pickupLng') || undefined,
  })
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors }
  }
  const v = parsed.data

  const supabase = await createClient()

  // One shop per owner, and a second submission -- a double tap, a back button
  // -- must not create one. RLS already scopes this to their own row; the
  // explicit owner filter says so at the call site rather than making the next
  // reader go and check the policy.
  const { data: existing } = await supabase
    .from('shops')
    .select('id')
    .eq('owner_id', userId)
    .limit(1)
    .maybeSingle()
  if (existing) {
    // A double tap or a back button. Nothing to do but show them where they
    // already are.
    revalidatePath('/shop', 'layout')
    redirect('/shop/dashboard')
  }

  /*
    NOTHING HERE CAN REFUSE THE SUBMISSION.

    This used to be a wall: no pin, no shop. `resolvePoint` returning null meant
    the merchant was sent back to a form they had filled in correctly, because
    Nominatim had never heard of their street -- which, measured on six
    realistic Yangon addresses, is the common case rather than the edge one. 0034
    dropped NOT NULL on `shops.pickup_lat/lng` so a null pin is now a legal,
    nameable state: "nobody has established this yet".

    Best available answer, and no invention:

      the owner's own device, tapped while standing in the shop   exact
      a lookup of the address they typed                          approximate
      null                                                        honest

    A ward centroid or a hub default would be a fourth option and a worse one
    than null: it looks like a location, so a rider drives to it.
  */
  const point = await resolvePoint(v.pickupAddress, v.pickupLat, v.pickupLng)

  const { error } = await supabase.from('shops').insert({
    owner_id: userId,
    name: v.name,
    phone: v.phone,
    goods_type: v.goodsType,
    pickup_address: v.pickupAddress,
    pickup_note: v.pickupNote || null,
    // Both or neither -- `shops_pickup_pin_complete` refuses half a pin, and
    // half a pin is what a `point?.lat` without the matching guard produces.
    pickup_lat: point?.lat ?? null,
    pickup_lng: point?.lng ?? null,
  })

  if (error) {
    console.error(`[setUpShop] insert failed for ${userId}: ${error.message}`)
    return {
      ok: false,
      message: 'Could not save your shop. Please try again, or contact the office.',
    }
  }

  /*
    TELL THE OFFICE, and leave a record that this shop was self-registered.

    Every other path that creates a shop writes one of these -- `shop.onboard`
    when the office types it in, `shop.approve` / `shop.reject` when it decides
    -- and self-registration was the one that wrote nothing. So a shop could
    appear in the list with no trace of who created it or when, which is exactly
    the question asked when something about it turns out to be wrong.
    `audit_log` is append-only and its insert policy is revoked, so this is the
    only way in.
    
    The actor is the OWNER, not the office: this runs under their session, so
    `write_audit` records their uid and the shop_owner role, which is the truth
    of what happened. Deliberately after the insert and deliberately not fatal --
    a shop that exists but went unlogged is a gap in the trail; a registration
    refused because the logging failed is a merchant turned away.
  */
  const { data: created } = await supabase
    .from('shops')
    .select('id')
    .eq('owner_id', userId)
    .limit(1)
    .maybeSingle()

  if (created) {
    const { error: auditError } = await supabase.rpc('write_audit', {
      p_action: 'shop.register',
      p_table: 'shops',
      p_entity_id: created.id,
      p_before: null,
      p_after: {
        name: v.name,
        phone: v.phone,
        goods_type: v.goodsType,
        pickup_address: v.pickupAddress,
        // Recorded because it decides whether the shop can book at all, and a
        // registration that produced no pin is the one the office may need to
        // help with.
        has_pin: point !== null,
        source: 'self_service',
      },
    })
    if (auditError) {
      console.error(`[setUpShop] audit failed for shop ${created.id}: ${auditError.message}`)
    }
  }

  /*
    Redirect from the action rather than returning ok and leaving the client to
    work it out: the dashboard is where the next thing to do lives -- including
    "add your pickup location" when this insert stored no pin -- and a form still
    on screen after a successful submit invites a second one. `redirect` throws,
    so nothing below runs.
  */
  revalidatePath('/shop', 'layout')
  redirect('/shop/dashboard')
}

/**
 * A pin the owner placed, or the best in-area match for what they typed, or
 * null when neither is available.
 *
 * NULL IS A RESULT, NOT A FAILURE, since 0034. Every `return null` below used
 * to end a registration; now it ends only the attempt to locate one, and the
 * shop is created with the address text alone.
 *
 * `servicePoint` is the same Zod rule the database CHECK mirrors, so a lookup
 * landing outside Greater Yangon comes back null here rather than becoming a
 * 23514 the owner cannot act on.
 */
async function resolvePoint(
  address: string,
  lat?: number,
  lng?: number,
): Promise<{ lat: number; lng: number } | null> {
  if (lat !== undefined && lng !== undefined) {
    const own = servicePoint.safeParse({ lat, lng })
    if (own.success) return own.data
    /*
      A pin outside Greater Yangon is not worth silently replacing with a
      geocode of the same address -- if they tapped the button, the tap is what
      they meant, and it was wrong. It comes back null, the shop registers on
      its address alone, and the dashboard then asks for a pickup location. The
      one thing not done is refusing the registration over it.
    */
    return null
  }

  try {
    const found = await forwardGeocode(address)
    const inArea = found.find((c) => c.inServiceArea)
    if (!inArea) return null
    const checked = servicePoint.safeParse(inArea.point)
    return checked.success ? checked.data : null
  } catch {
    // Nominatim is rate-limited and occasionally down. Coming back empty is
    // honest; inventing a coordinate is not. Since 0034 an outage costs the
    // merchant a pin, not a registration.
    return null
  }
}
