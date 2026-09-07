/**
 * Whether a shop may trade, and why not when it may not.
 *
 * TWO SEPARATE FACTS, deliberately not one boolean:
 *
 *   approved_at = null   the office has not looked at this shop yet
 *   is_active   = false  the office looked, and switched it off
 *
 * Collapsing them would tell a brand-new shop it had been suspended, and tell a
 * suspended one it was awaiting review. Those call for opposite actions from the
 * owner -- wait, versus ring the office -- so the distinction has to survive all
 * the way to the message on screen.
 *
 * Mirrors migration 0026, where `tg_shops_guard` makes both fields writable only
 * by the office. Before that guard existed a suspended shop could set
 * `is_active = true` on itself, which is why neither of these is a flag the app
 * can afford to treat casually.
 */

export type ShopApprovalInput = {
  isActive: boolean
  approvedAt: string | null
  rejectedAt?: string | null
}

export type ShopApprovalState = 'awaiting' | 'rejected' | 'suspended' | 'active'

export function shopApprovalState(shop: ShopApprovalInput): ShopApprovalState {
  // Rejection is the office's final word and outranks everything: a rejected
  // shop is not merely waiting, and telling it so would invite it to keep
  // waiting for an answer that has already been given.
  if (shop.rejectedAt) return 'rejected'
  /*
    SUSPENSION OUTRANKS AWAITING, and the order of these two lines is now
    load-bearing. It used to be the other way round, which was harmless while
    both states were unusable — but 0031 lets `awaiting` trade, and a shop the
    office suspended BEFORE reviewing it is `is_active = false` with
    `approved_at` still null. Reported as `awaiting` it would have kept
    trading, so suspending a suspicious new shop would have done nothing.

    Being switched off is an act; not having been looked at is an absence. The
    act wins.
  */
  if (!shop.isActive) return 'suspended'
  if (!shop.approvedAt) return 'awaiting'
  return 'active'
}

/**
 * May this shop book parcels at all?
 *
 * 0031 WIDENED THIS. Approval used to gate trade, so a merchant's first day was
 * spent waiting — friction on exactly the day they are most likely to give up.
 * It now gates CASH instead: an `awaiting` shop books prepaid parcels from its
 * first minute, and COD waits for a human to have looked.
 */
export function shopUsable(shop: ShopApprovalInput): boolean {
  const state = shopApprovalState(shop)
  return state === 'active' || state === 'awaiting'
}

/**
 * May this shop take money at the door?
 *
 * THE BOUNDED EXPOSURE, and the reason instant access is safe to give. An
 * unvetted shop booking COD means a rider collects a customer's cash, it lands
 * in `cod_ledger` against that rider, and the office learns the shop was
 * fictitious while holding money it owes to nobody. Prepaid carries none of
 * that — the money never passes through us.
 *
 * Mirrored by `tg_orders_shop_gate` in SQL, because `orders_insert_shop` checks
 * ownership alone and a shop owner can POST straight to PostgREST.
 */
export function shopCanUseCod(shop: ShopApprovalInput): boolean {
  return shopApprovalState(shop) === 'active'
}

/**
 * Why booking was refused, for the shop to read.
 *
 * `null` for an active shop, so a caller cannot accidentally show a refusal to
 * somebody who was not refused.
 */
export const SHOP_BLOCKED_MESSAGE: Record<Exclude<ShopApprovalState, 'active'>, string> = {
  // No longer a refusal. An awaiting shop can trade — this says what is still
  // held back, and it is deliberately about COD rather than about waiting.
  awaiting:
    'You can book prepaid parcels now. Cash on delivery unlocks once the Mingalar Express office has reviewed your shop.',
  rejected:
    'This shop was not approved. Contact the Mingalar Express office if you think that is a mistake.',
  suspended:
    'This shop is suspended, so it cannot take new orders. Contact the Mingalar Express office to reactivate it.',
}

/**
 * What to tell the shop, or `null` when there is nothing to say.
 *
 * Note that `awaiting` returns a message while `shopUsable` returns true: it is
 * a notice, not a refusal, and callers that treat any message as a block would
 * put the old wall back.
 */
export function shopBlockedMessage(shop: ShopApprovalInput): string | null {
  const state = shopApprovalState(shop)
  return state === 'active' ? null : SHOP_BLOCKED_MESSAGE[state]
}

/** The refusal for a COD booking from a shop nobody has looked at yet. */
export const COD_NEEDS_REVIEW =
  'Cash on delivery unlocks once the office has reviewed your shop. Book this parcel as prepaid, or contact the office.'
