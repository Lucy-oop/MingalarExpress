/**
 * The notification seam.
 *
 * Everything below the outbox is written against `SmsProvider` and nothing else.
 * Swapping the Yangon aggregator for another one, or adding Viber alongside it,
 * is a new file in `providers/` — the outbox, the quiet hours, the dedupe and
 * the worker do not move.
 */

export type NotificationEvent = 'parcel_failed' | 'parcel_held'
export type Lang = 'my' | 'en'

/**
 * `retryable` is the field that matters.
 *
 * A gateway timeout should come back in four minutes. An invalid number should
 * never be tried again — without this distinction a mistyped phone burns five
 * attempts and four hours of backoff before anyone finds out, and the shop is
 * never told at all.
 */
export type SendResult =
  | { ok: true; id?: string | null }
  | { ok: false; error: string; retryable: boolean }

export interface SmsProvider {
  /** Recorded on the outbox row, so a bad batch can be traced to a gateway. */
  readonly name: string
  send(to: string, body: string): Promise<SendResult>
}

/** What `tg_orders_notify` snapshots into `notification_outbox.payload`. */
export type NotificationPayload = {
  code?: string | null
  customer_name?: string | null
  attempt?: number | null
  max_attempts?: number | null
  fail_reason?: string | null
  cod_amount?: number | null
  payment_method?: string | null
}

export type OutboxRow = {
  id: number
  event: string
  channel: string
  order_id: string | null
  shop_id: string | null
  to_phone: string | null
  lang: string
  payload: NotificationPayload
  attempts: number
}
