'use server'

import { getShopDeliveryDetail, type ShopDeliveryDetail } from '@/lib/orders/queries'
import { markNoticesSeen } from '@/lib/notices/actions'

/**
 * Fetch one delivered parcel for the feed's modal, and mark the feed read.
 *
 * A SERVER ACTION RATHER THAN A ROUTE HANDLER, because everything it needs is
 * already here: `createClient()` carries the caller's cookies, so RLS scopes
 * the read exactly as it does everywhere else, and there is no new URL to
 * authorise, rate-limit or forget about. The client gets a typed value back
 * from an `await`, and the page never navigates.
 *
 * THE READ MARK RIDES ALONG, and does not block. Opening the bell already
 * calls `markNoticesSeen`; opening a row from the FULL PAGE did not, so a shop
 * that went straight to /shop/notifications could read everything and keep the
 * badge. This closes that without a second round trip from the browser.
 *
 * WHAT "READ" MEANS HERE, precisely, because it is easy to assume more:
 * `notices_seen_at` is a single watermark per reader, not per-notification
 * state. Marking one row read marks everything up to now read, which is what
 * the bell has always counted. Genuine per-row read state would need a table
 * and is a different feature; this is the existing model, applied consistently.
 */
export async function openDeliveryNotification(
  orderId: string,
): Promise<ShopDeliveryDetail | null> {
  const detail = await getShopDeliveryDetail(orderId)
  // Not awaited for its own sake: a failed marker costs a stale badge, and
  // must never cost the modal its contents. Same rule markNoticesSeen states.
  void markNoticesSeen()
  return detail
}

/** The batch modal needs no fetch — the group already carries its rows. */
export async function markFeedRead(): Promise<void> {
  await markNoticesSeen()
}
