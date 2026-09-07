/**
 * What happens when the dispatcher presses Load — and why it sometimes cannot.
 *
 * WHY THIS EXISTS. Loading used to be three buttons on every trip card, all
 * enabled together, all reading the same global tick count. With four routes and
 * two runs each that is twelve identical "Load 10 selected" buttons, and the only
 * thing choosing the destination is which one the dispatcher happens to click.
 * A mis-click puts ten parcels on the wrong bike, undoable one parcel at a time.
 * There is now one button, against one explicit target, and this module decides
 * what it does and whether it may.
 *
 * THE LEG IS DERIVED, NOT CHOSEN. `load_trip` refuses a return-leg load of a
 * non-return parcel and a non-return load of a returned one, both as
 * `leg_resolution_mismatch`. So the selection already determines the leg, and
 * offering it as a third button was offering a choice the server does not have.
 * Deriving it makes that error unreachable rather than merely explained.
 *
 * THE CEILINGS MIRROR SQL EXACTLY, including its asymmetry: the parcel cap
 * counts delivery legs only and fires only on a delivery load, while the COD cap
 * spans every leg but excludes returns, whose cod_amount describes money nobody
 * will collect. A pre-check that used one rule for both would refuse loads the
 * server would have accepted, which is worse than no pre-check at all.
 * `routes.max_parcels_per_trip` and `max_cod_per_trip` are already on the board
 * payload, so none of this costs a query.
 *
 * SQL REMAINS THE AUTHORITY. This exists so the button can disable itself with
 * the same numbers, before a round trip.
 */

export type LoadLeg = 'delivery' | 'pickup' | 'return'

/** What the panel knows about a ticked parcel. */
export type LoadParcel = {
  id: string
  codAmount: number
  /** The shop asked for it back: `orders.resolution = 'return'`. */
  isReturn: boolean
  /**
   * Already collected and sitting at the hub: `status = 'picked_up'` with no
   * trip. Outbound only.
   */
  isHubHeld: boolean
}

/** What the board knows about the run being loaded into. */
export type LoadTarget = {
  tripId: string
  status: string
  /** Legs already on the run, for the ceilings. */
  loaded: ReadonlyArray<{ leg: LoadLeg; codAmount: number }>
  maxParcels: number
  maxCod: number
  /** A run with no rider cannot carry hub-held parcels — see loadPlan. */
  hasRider: boolean
}

export type LoadBlocker =
  | 'no_target'
  | 'nothing_selected'
  | 'mixed_legs'
  | 'target_not_loadable'
  | 'over_parcel_cap'
  | 'over_cod_cap'
  | 'held_not_collectable'
  | 'held_needs_rider'

export type LoadPlan = {
  leg: LoadLeg
  blocker: LoadBlocker | null
  count: number
  /** Delivery-leg parcels the run would carry afterwards. */
  projectedParcels: number
  /** Collectable COD the run would carry afterwards, returns excluded. */
  projectedCod: number
  /** Delivery slots left, never negative. */
  parcelHeadroom: number
  /** Collectable COD headroom, never negative. */
  codHeadroom: number
}

/**
 * `mode` is the dispatcher's Deliver/Collect choice, and it only applies to a
 * selection with no returns in it. A return selection ignores it entirely.
 */
export function loadPlan(
  selection: readonly LoadParcel[],
  target: LoadTarget | null,
  mode: 'delivery' | 'pickup' = 'delivery',
): LoadPlan {
  const returns = selection.filter((p) => p.isReturn).length
  const mixed = returns > 0 && returns < selection.length

  /*
    A parcel already on the hub shelf can only go OUT. 0027's load_trip accepts
    `picked_up` for a delivery leg and refuses it for a pickup one -- fetching
    what we are already holding sends a rider across Yangon for nothing -- so
    the Collect choice must not even be offered for a selection containing one.
    Mirrored here rather than left to the RPC so the dispatcher sees it before
    pressing the button, not as a 55000 afterwards.
  */
  const held = selection.filter((p) => p.isHubHeld).length
  const heldMixedWithPickup = held > 0 && mode === 'pickup'

  const leg: LoadLeg = returns > 0 && !mixed ? 'return' : held > 0 ? 'delivery' : mode

  const loaded = target?.loaded ?? []
  // Exactly load_trip's counters. Delivery legs for the parcel cap; every leg
  // except return for the cash cap.
  const loadedDeliveries = loaded.filter((p) => p.leg === 'delivery').length
  const loadedCod = loaded
    .filter((p) => p.leg !== 'return')
    .reduce((sum, p) => sum + p.codAmount, 0)

  const addedDeliveries = leg === 'delivery' ? selection.length : 0
  const addedCod =
    leg === 'return' ? 0 : selection.reduce((sum, p) => sum + p.codAmount, 0)

  const projectedParcels = loadedDeliveries + addedDeliveries
  const projectedCod = loadedCod + addedCod

  const blocker = ((): LoadBlocker | null => {
    if (!target) return 'no_target'
    if (selection.length === 0) return 'nothing_selected'
    // Before the ceilings: a mixed selection has no single leg, so there is
    // nothing coherent to measure it against.
    if (mixed) return 'mixed_legs'
    if (heldMixedWithPickup) return 'held_not_collectable'
    // load_trip refuses these outright: the parcel keeps `picked_up`, so the
    // run's rider becomes its rider, and a run without one would leave it
    // rider-less in a state orders_assigned_needs_rider forbids.
    if (held > 0 && !target.hasRider) return 'held_needs_rider'
    if (target.status !== 'planned' && target.status !== 'loading') return 'target_not_loadable'
    // `p_leg = 'delivery' and v_parcels > v_r.max_parcels_per_trip`
    if (leg === 'delivery' && projectedParcels > target.maxParcels) return 'over_parcel_cap'
    if (projectedCod > target.maxCod) return 'over_cod_cap'
    return null
  })()

  return {
    leg,
    blocker,
    count: selection.length,
    projectedParcels,
    projectedCod,
    // Clamped, because the old card rendered "room for -3 more" whenever a run
    // went over its ceiling by another route's doing.
    parcelHeadroom: Math.max(0, (target?.maxParcels ?? 0) - loadedDeliveries),
    codHeadroom: Math.max(0, (target?.maxCod ?? 0) - loadedCod),
  }
}

/** Told as the next action, not as a complaint about current state. */
export const LOAD_BLOCKER_MESSAGE: Record<LoadBlocker, string> = {
  no_target: 'Pick a run to load into.',
  nothing_selected: 'Tick some parcels first.',
  mixed_legs: 'Returns cannot travel with deliveries — load them separately.',
  target_not_loadable: 'That run has already left.',
  over_parcel_cap: 'That would put the run over its parcel limit.',
  over_cod_cap: 'That would put the run over its cash limit.',
  held_not_collectable:
    'These are already at the hub — they can only go out for delivery, not be collected again.',
  held_needs_rider: 'Give this run a rider before loading parcels held at the hub.',
}

// ---------------------------------------------------------------------------
// Manifest summary
// ---------------------------------------------------------------------------

export type ManifestParcel = {
  leg: LoadLeg
  areaName: string | null
  codAmount: number
  paymentMethod: 'cod' | 'prepaid'
}

export type ManifestSummary = {
  total: number
  deliveries: number
  pickups: number
  returns: number
  cod: number
  /** Destination areas, busiest first, so a run reads as a shape not a list. */
  areas: Array<{ name: string; count: number }>
}

/**
 * What a run is carrying, without listing it.
 *
 * A 30-parcel manifest was ~1,600px of card and thirty identical status pills;
 * four routes made the column seven thousand pixels tall. A dispatcher deciding
 * whether a run is ready needs the shape — how many, going where, carrying how
 * much cash — and only occasionally the codes.
 */
export function summariseManifest(parcels: readonly ManifestParcel[]): ManifestSummary {
  const byArea = new Map<string, number>()
  let cod = 0
  let deliveries = 0
  let pickups = 0
  let returns = 0

  for (const p of parcels) {
    if (p.leg === 'delivery') deliveries += 1
    else if (p.leg === 'pickup') pickups += 1
    else returns += 1
    // Matches the cash ceiling: a return's cod_amount is money nobody collects.
    if (p.paymentMethod === 'cod' && p.leg !== 'return') cod += p.codAmount
    const name = p.areaName ?? 'No area'
    byArea.set(name, (byArea.get(name) ?? 0) + 1)
  }

  return {
    total: parcels.length,
    deliveries,
    pickups,
    returns,
    cod,
    areas: [...byArea.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }
}
