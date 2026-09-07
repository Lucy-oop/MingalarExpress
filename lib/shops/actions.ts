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
 * THE COORDINATES ARE NOT TYPED. `shops.pickup_lat/lng` are NOT NULL behind a
 * geofence CHECK and `createOrder` copies them onto every order, where they
 * become the rider's navigation target -- so they cannot be skipped, and they
 * cannot be invented either. Two honest sources, in order of trust:
 *
 *   1. the owner's own device, tapped while standing in the shop
 *   2. a lookup of the address they typed
 *
 * Nothing else. If both are absent, NO ROW IS WRITTEN and the owner is told to
 * tap the location button or ring the office. A guessed pin -- a ward centroid,
 * a hub default -- sends a rider to the wrong street while the screen shows the
 * right address, and the seeded ward centroids are flagged VERIFY-CENTROID for
 * exactly that reason: Bahan's is 2.2 km out.
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

  const point = await resolvePoint(v.pickupAddress, v.pickupLat, v.pickupLng)
  if (!point) {
    return {
      ok: false,
      fieldErrors: {
        pickupAddress: [
          'We could not find that address on the map. Tap "Use my current location" while you are at the shop, or contact the office and they will set it up for you.',
        ],
      },
    }
  }

  const { error } = await supabase.from('shops').insert({
    owner_id: userId,
    name: v.name,
    phone: v.phone,
    goods_type: v.goodsType,
    pickup_address: v.pickupAddress,
    pickup_note: v.pickupNote || null,
    pickup_lat: point.lat,
    pickup_lng: point.lng,
  })

  if (error) {
    console.error(`[setUpShop] insert failed for ${userId}: ${error.message}`)
    return {
      ok: false,
      message: 'Could not save your shop. Please try again, or contact the office.',
    }
  }

  /*
    Redirect from the action rather than returning ok and leaving the client to
    work it out: the dashboard is where the "waiting for the office" message
    lives, and a form still on screen after a successful submit invites a second
    one. `redirect` throws, so nothing below runs.
  */
  revalidatePath('/shop', 'layout')
  redirect('/shop/dashboard')
}

/**
 * A pin the owner placed, or the best in-area match for what they typed.
 *
 * `servicePoint` is the same Zod rule the database CHECK mirrors, so a lookup
 * landing outside Greater Yangon is rejected here rather than becoming a 23514
 * the owner cannot act on.
 */
async function resolvePoint(
  address: string,
  lat?: number,
  lng?: number,
): Promise<{ lat: number; lng: number } | null> {
  if (lat !== undefined && lng !== undefined) {
    const own = servicePoint.safeParse({ lat, lng })
    if (own.success) return own.data
    // A pin outside the area is a mistake worth correcting, not worth silently
    // replacing with a geocode of the same address.
    return null
  }

  try {
    const found = await forwardGeocode(address)
    const inArea = found.find((c) => c.inServiceArea)
    if (!inArea) return null
    const checked = servicePoint.safeParse(inArea.point)
    return checked.success ? checked.data : null
  } catch {
    // Nominatim is rate-limited and occasionally down. Failing to a "the office
    // will call you" is honest; inventing a coordinate is not.
    return null
  }
}
