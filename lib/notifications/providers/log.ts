import type { SendResult, SmsProvider } from '../types'

/**
 * The provider that sends nothing.
 *
 * This is the default, and it is what runs on staging and in development. Two
 * reasons it is a real implementation rather than a stub:
 *
 *   1. Staging shares a shape with production but not a phone book. Without
 *      this, testing the failed-parcel loop texts whoever's number is in the
 *      seed data.
 *   2. The whole pipeline — outbox, quiet hours, dedupe, backoff, dead-letter —
 *      is provable before a paid gateway account exists. Which it does not yet.
 *
 * It reports success, so rows reach `sent` and the drain loop can be watched
 * end to end. The message id is marked so nobody mistakes one for a real
 * gateway receipt while reading the outbox.
 */
export function createLogProvider(): SmsProvider {
  return {
    name: 'log',
    async send(to: string, body: string): Promise<SendResult> {
      console.info('[sms:log] would send', { to, chars: body.length, body })
      return { ok: true, id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
    },
  }
}
