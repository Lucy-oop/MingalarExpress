/**
 * Why a run cannot leave yet — one reason, in the order a dispatcher fixes them.
 *
 * WHY THIS EXISTS. The board used to express this as a bare boolean:
 *
 *     const canDepart = canLoad && trip.parcelCount + trip.pickupCount > 0
 *     <Button disabled={busy || !canDepart}>Depart trip</Button>
 *
 * which produced a button that did nothing and said nothing. `buttonVariants`
 * carries `disabled:pointer-events-none`, so a disabled control has no hover, no
 * cursor change and CANNOT carry a title tooltip -- and disabled buttons leave
 * the tab order, so a keyboard user cannot reach it to find out either. All that
 * survives is `opacity-50`, which reads as styling rather than as a rule. Every
 * dispatcher who met it reported the same thing: the button is broken.
 *
 * AND IT WAS INCOMPLETE. `depart_trip` refuses a run with no rider, but the
 * boolean above never checked for one -- so that case left the button ENABLED,
 * failed on the server, and surfaced as a banner at the top of a long board
 * while the dispatcher was looking at a card near the bottom. Two failure modes,
 * two different bad experiences, neither of them a message beside the button.
 *
 * The order below mirrors depart_trip's own checks exactly (status, then rider,
 * then emptiness). It has to: reporting them in a different order would tell a
 * dispatcher to load parcels, and then the server would refuse for a missing
 * rider they were never told about.
 */

export type DepartBlocker = 'not_departable' | 'no_rider' | 'empty'

export type DepartGate = {
  status: string
  riderId: string | null
  parcelCount: number
  pickupCount: number
}

export function departBlocker(g: DepartGate): DepartBlocker | null {
  // Mirrors `trip_not_departable`. The action row is only rendered for these two
  // statuses, so this is a backstop rather than the common case.
  if (g.status !== 'planned' && g.status !== 'loading') return 'not_departable'

  // Mirrors `trip_has_no_rider`. Before the parcel count, exactly as in SQL.
  if (!g.riderId) return 'no_rider'

  // Mirrors `trip_empty`. Pickups count: a run collecting from ten shops and
  // delivering nothing is a real run, which is why this is the SUM and not the
  // parcel count alone.
  if (g.parcelCount + g.pickupCount <= 0) return 'empty'

  return null
}

/**
 * What to show beside the button. Written as the next action to take, not as a
 * complaint -- "Assign a rider first", not "No rider assigned".
 */
export const DEPART_BLOCKER_MESSAGE: Record<DepartBlocker, string> = {
  not_departable: 'This run has already left.',
  no_rider: 'Assign a rider first.',
  empty: 'Load at least one parcel or pickup first.',
}

export function canDepart(g: DepartGate): boolean {
  return departBlocker(g) === null
}
