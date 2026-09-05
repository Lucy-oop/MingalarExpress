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
  if (!shop.approvedAt) return 'awaiting'
  if (!shop.isActive) return 'suspended'
  return 'active'
}

/** May this shop book parcels? Only when both facts agree. */
export function shopUsable(shop: ShopApprovalInput): boolean {
  return shopApprovalState(shop) === 'active'
}

/**
 * Why booking was refused, for the shop to read.
 *
 * `null` for an active shop, so a caller cannot accidentally show a refusal to
 * somebody who was not refused.
 */
export const SHOP_BLOCKED_MESSAGE: Record<Exclude<ShopApprovalState, 'active'>, string> = {
  awaiting:
    'Your shop is waiting for the Mingalar Express office to confirm it. You can book parcels as soon as it is approved.',
  rejected:
    'This shop was not approved. Contact the Mingalar Express office if you think that is a mistake.',
  suspended:
    'This shop is suspended, so it cannot take new orders. Contact the Mingalar Express office to reactivate it.',
}

export function shopBlockedMessage(shop: ShopApprovalInput): string | null {
  const state = shopApprovalState(shop)
  return state === 'active' ? null : SHOP_BLOCKED_MESSAGE[state]
}
