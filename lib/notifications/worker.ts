import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { MAX_LINK_BASE_LENGTH, orderLink, renderNotification } from './messages'
import { getSmsProvider } from './providers'
import { smsSegments } from './sms'
import type { OutboxRow, SmsProvider } from './types'

/**
 * One pass over the outbox.
 *
 * The whole point of this function is that it runs OUTSIDE the transaction that
 * created the work. A gateway that hangs for thirty seconds delays a text; it
 * cannot delay, fail or roll back a rider marking a parcel failed.
 *
 * Claim / send / settle, one row at a time. Sequential rather than parallel on
 * purpose: volume is a handful of messages a day, aggregators here rate-limit
 * aggressively, and a serial loop makes the logs readable when something is
 * wrong at 2am.
 */

export type DrainReport = {
  provider: string
  claimed: number
  sent: number
  /** Retryable failures, put back with backoff. */
  requeued: number
  /** Permanent failures and exhausted retries. */
  dead: number
}

const DEFAULT_LIMIT = 20

export async function drainOutbox(options?: {
  limit?: number
  /** Injectable so a test never needs env or a network. */
  provider?: SmsProvider
}): Promise<DrainReport> {
  const provider = options?.provider ?? getSmsProvider()
  const supabase = createAdminClient()
  const report: DrainReport = { provider: provider.name, claimed: 0, sent: 0, requeued: 0, dead: 0 }

  const { data, error } = await supabase.rpc('claim_notifications', {
    p_limit: options?.limit ?? DEFAULT_LIMIT,
  })
  if (error) throw new Error(`could not claim notifications: ${error.message}`)

  const rows = (data ?? []) as unknown as OutboxRow[]
  report.claimed = rows.length
  if (rows.length === 0) return report

  const base = siteBaseUrl()

  for (const row of rows) {
    // Should be unreachable — enqueue_notification dead-letters a shop with no
    // phone rather than queueing it — but a claimed row with nowhere to go must
    // never be retried five times before anyone notices.
    if (!row.to_phone) {
      await settle(supabase, row.id, { ok: false, error: 'no_recipient_phone', retryable: false })
      report.dead += 1
      continue
    }

    const body = renderNotification({
      event: row.event,
      lang: row.lang,
      payload: row.payload,
      link: orderLink(base, row.payload?.code ?? null),
    })

    // Not fatal, but it is a 50% bill increase nothing else would report.
    const segments = smsSegments(body)
    if (segments > 2) {
      console.warn(
        `[sms] message ${row.id} is ${segments} segments. ` +
          `NEXT_PUBLIC_SITE_URL should be at most ${MAX_LINK_BASE_LENGTH} characters; ` +
          `it is ${base.length}.`,
      )
    }

    let result
    try {
      result = await provider.send(row.to_phone, body)
    } catch (err) {
      // A provider that throws instead of returning is a bug in the provider.
      // Treat it as retryable: the alternative is losing the message to it.
      result = {
        ok: false as const,
        error: `provider threw: ${err instanceof Error ? err.message : String(err)}`,
        retryable: true,
      }
    }

    const outcome = await settle(supabase, row.id, result, provider.name)
    if (outcome === 'sent') report.sent += 1
    else if (outcome === 'dead') report.dead += 1
    else report.requeued += 1
  }

  return report
}

type Settled = 'sent' | 'dead' | 'queued'

async function settle(
  supabase: ReturnType<typeof createAdminClient>,
  id: number,
  result: { ok: true; id?: string | null } | { ok: false; error: string; retryable: boolean },
  providerName = 'unknown',
): Promise<Settled> {
  if (result.ok) {
    const { error } = await supabase.rpc('complete_notification', {
      p_id: id,
      p_provider: providerName,
      p_message_id: result.id ?? undefined,
    })
    if (error) throw new Error(`could not mark ${id} sent: ${error.message}`)
    return 'sent'
  }

  // SQL owns the retry ceiling and the backoff curve, so the worker cannot
  // disagree with a second worker about when to give up.
  const { data, error } = await supabase.rpc('fail_notification', {
    p_id: id,
    p_error: result.error,
    p_retryable: result.retryable,
  })
  if (error) throw new Error(`could not record failure on ${id}: ${error.message}`)

  const status = (data as unknown as { status?: string } | null)?.status
  return status === 'dead' ? 'dead' : 'queued'
}

/**
 * Where the links point. Empty is tolerated — a message with no link is still
 * worth sending — but it is worth a loud line in the log, because a shop that
 * cannot tap through has to go and find the parcel themselves.
 */
function siteBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (url) return url.replace(/\/+$/, '')
  console.warn('[sms] NEXT_PUBLIC_SITE_URL is not set; messages will carry no link.')
  return ''
}
