import 'server-only'

import type { SmsProvider } from '../types'
import { createLogProvider } from './log'
import { createHttpProvider } from './http'

/**
 * Which gateway this deployment uses.
 *
 * Defaults to `log`, deliberately. An unconfigured environment must not silently
 * fall through to a real gateway, and an environment that MEANT to send but is
 * missing a key should say so rather than pretend.
 */
export function getSmsProvider(): SmsProvider {
  const kind = (process.env.SMS_PROVIDER ?? 'log').trim().toLowerCase()

  if (kind === 'log' || kind === '') return createLogProvider()

  if (kind === 'http') {
    const url = process.env.SMS_API_URL
    const apiKey = process.env.SMS_API_KEY
    const senderId = process.env.SMS_SENDER_ID
    if (!url || !apiKey || !senderId) {
      throw new Error(
        'SMS_PROVIDER=http needs SMS_API_URL, SMS_API_KEY and SMS_SENDER_ID. ' +
          'Unset SMS_PROVIDER to fall back to the log provider.',
      )
    }
    return createHttpProvider({
      url,
      apiKey,
      senderId,
      name: process.env.SMS_PROVIDER_NAME ?? 'http',
      authHeader: process.env.SMS_AUTH_HEADER,
      authScheme: process.env.SMS_AUTH_SCHEME,
    })
  }

  throw new Error(`Unknown SMS_PROVIDER "${kind}". Expected "log" or "http".`)
}
