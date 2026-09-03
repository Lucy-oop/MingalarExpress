import type { SendResult, SmsProvider } from '../types'

/**
 * A generic JSON-over-HTTP gateway.
 *
 * READ THIS BEFORE POINTING IT AT A REAL AGGREGATOR. The field names below are
 * the common shape, not any particular vendor's contract, and the vendor has not
 * been chosen yet. When it is, the two things to change are `buildBody` and
 * `readMessageId` — everything else (auth header, timeout, retry
 * classification) is provider-independent and should not need touching.
 *
 * Myanmar specifics that shaped this:
 *   - A registered sender ID is mandatory on MPT / ATOM / Ooredoo and takes
 *     weeks. `SMS_SENDER_ID` is required rather than optional so a
 *     misconfiguration fails at startup instead of at the gateway.
 *   - Aggregators here commonly return HTTP 200 with a failure code in the
 *     body, so a 2xx alone is not treated as success.
 */

export type HttpProviderConfig = {
  url: string
  apiKey: string
  senderId: string
  /** Header carrying the key. Some gateways want `X-API-Key` rather than Bearer. */
  authHeader?: string
  authScheme?: string
  timeoutMs?: number
  name?: string
}

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Which failures are worth trying again.
 *
 * 429 and 5xx are the gateway's problem and will pass. A 4xx is ours — a
 * malformed number, an unregistered sender, an expired key — and retrying it
 * five times just delays anyone noticing.
 */
function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export function createHttpProvider(config: HttpProviderConfig): SmsProvider {
  const name = config.name ?? 'http'
  const authHeader = config.authHeader ?? 'Authorization'
  const authScheme = config.authScheme ?? 'Bearer'

  return {
    name,
    async send(to: string, body: string): Promise<SendResult> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS)

      try {
        const res = await fetch(config.url, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            [authHeader]: authScheme ? `${authScheme} ${config.apiKey}` : config.apiKey,
          },
          body: JSON.stringify({
            // VENDOR-SPECIFIC. See the note at the top of this file.
            sender: config.senderId,
            to,
            message: body,
          }),
        })

        const text = await res.text()

        if (!res.ok) {
          return {
            ok: false,
            error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
            retryable: retryableStatus(res.status),
          }
        }

        // A 200 is not a send. Most local gateways answer 200 with a status
        // field, so an unparseable or negative body is a failure, not a success.
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          return { ok: false, error: `unparseable gateway response: ${text.slice(0, 200)}`, retryable: false }
        }

        const id = readMessageId(parsed)
        if (id === null) {
          return { ok: false, error: `gateway rejected: ${text.slice(0, 200)}`, retryable: false }
        }
        return { ok: true, id }
      } catch (err) {
        // Timeout or network. Always worth another pass.
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `network: ${message}`, retryable: true }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/** VENDOR-SPECIFIC. Returns the gateway's id, or null when it refused. */
function readMessageId(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  const id = o.message_id ?? o.messageId ?? o.id
  if (typeof id === 'string' && id.length > 0) return id
  if (typeof id === 'number') return String(id)
  return null
}
