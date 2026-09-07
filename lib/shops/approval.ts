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
 * owner -- carry on booking prepaid, versus ring the office -- so the
 * distinction has to survive all the way to the message on screen.
 *
 * Mirrors migration 0026, where `tg_shops_guard` makes both fields writable only
 * by the office. Before that guard existed a suspended shop could set
 * `is_active = true` on itself, which is why neither of these is a flag the app
 * can afford to treat casually.
 */

import type { MessageKey } from '@/lib/i18n'

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
 * What to tell the shop, as DICTIONARY KEYS rather than English.
 *
 * WHY KEYS. Burmese is this app's default locale (`DEFAULT_LOCALE = 'my'`), and
 * these strings used to be English literals rendered straight into the alert on
 * the dashboard and on settings. The heading beside them came from the
 * dictionary, so a Burmese merchant read a Burmese title over an English
 * paragraph — and the paragraph is the half that says "you can trade right
 * now". The person most likely to believe they were blocked could not read the
 * reassurance.
 *
 * A key crosses the RSC boundary safely where a translator does not: only
 * serialisable values may cross, which is why this module hands back a key and
 * the page calls `t()`. Same lesson as 57da184 — route the locale, not the
 * translator.
 *
 * THE TITLE LIVES HERE TOO, and that fixed a real bug. `app/shop/settings` had
 * its own local title map while `app/shop/dashboard` hardcoded the awaiting
 * title for every state, so a SUSPENDED shop was headed "Cash on delivery not
 * unlocked yet" above a body saying it could not take orders. One map cannot
 * disagree with itself.
 */
export const SHOP_BLOCKED_COPY: Record<
  Exclude<ShopApprovalState, 'active'>,
  { title: MessageKey; body: MessageKey }
> = {
  // No longer a refusal. An awaiting shop can trade — this says what is still
  // held back, and it is deliberately about COD rather than about waiting.
  awaiting: { title: 'shop.blocked.awaitingTitle', body: 'shop.blocked.awaiting' },
  rejected: { title: 'shop.blocked.rejectedTitle', body: 'shop.blocked.rejected' },
  suspended: { title: 'shop.blocked.suspendedTitle', body: 'shop.blocked.suspended' },
}

/**
 * What to tell the shop, or `null` when there is nothing to say.
 *
 * Note that `awaiting` returns copy while `shopUsable` returns true: it is a
 * notice, not a refusal, and callers that treat any message as a block would put
 * the old wall back. `tone` says which is which so the two callers cannot drift
 * — an amber alert on a working dashboard reads as a fault.
 */
export function shopBlockedCopy(
  shop: ShopApprovalInput,
): { title: MessageKey; body: MessageKey; tone: 'info' | 'warning' } | null {
  const state = shopApprovalState(shop)
  if (state === 'active') return null
  return { ...SHOP_BLOCKED_COPY[state], tone: state === 'awaiting' ? 'info' : 'warning' }
}

/**
 * The refusal for a COD booking from a shop nobody has looked at yet.
 *
 * Still a bare key: `createOrder` returns it as a form error, and the form
 * renders `state.error` as a string. Translating it there is a wider change to
 * how server-action errors carry copy, so it is left as one key the caller
 * resolves.
 */
export const COD_NEEDS_REVIEW: MessageKey = 'shop.codNeedsReview'
