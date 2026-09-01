/**
 * Rider-facing error messages.
 *
 * Separate module (not the `'use server'` file) so it can be unit-tested — a
 * `'use server'` module may only export async functions.
 *
 * Tone matters here more than anywhere else in the product: the reader is on a
 * bike, in the rain, holding someone else's cash. Messages say what happened and
 * what to do, never what the database called it.
 */

export type RiderErrorKind =
  | 'superseded'
  | 'taken'
  | 'needs_proof'
  | 'needs_reason'
  | 'offline_rider'
  | 'not_yours'
  | 'forbidden'
  | 'network'
  | 'unknown'

export type ExplainedRiderError = { kind: RiderErrorKind; message: string; retryable: boolean }

const RULES: Array<{ match: RegExp; value: ExplainedRiderError }> = [
  {
    match: /proof_required/i,
    value: {
      kind: 'needs_proof',
      message: 'Take a photo of the delivery before marking it done.',
      retryable: false,
    },
  },
  {
    match: /fail_reason_required/i,
    value: {
      kind: 'needs_reason',
      message: 'Say what went wrong before marking this failed.',
      retryable: false,
    },
  },
  {
    match: /order_not_assignable/i,
    value: {
      kind: 'taken',
      message: 'Another rider took that job first.',
      retryable: false,
    },
  },
  {
    match: /illegal_transition/i,
    value: {
      kind: 'superseded',
      message: 'This job has already moved on. Pull down to refresh.',
      retryable: false,
    },
  },
  {
    match: /rider_unavailable/i,
    value: {
      kind: 'offline_rider',
      message: 'Go online and make sure you are under your parcel limit, then try again.',
      retryable: true,
    },
  },
  {
    match: /rider_profile_missing/i,
    value: {
      kind: 'forbidden',
      message: 'Your rider profile is not set up. Contact the office.',
      retryable: false,
    },
  },
  {
    match: /order_not_found/i,
    value: { kind: 'superseded', message: 'That job is no longer available.', retryable: false },
  },
  {
    match: /failed to fetch|networkerror|load failed|network request failed|timeout/i,
    value: {
      kind: 'network',
      message: 'No signal. Saved — it will send when you are back online.',
      retryable: true,
    },
  },
  {
    match: /forbidden|42501|permission denied|row-level security/i,
    value: { kind: 'forbidden', message: 'You cannot change that job.', retryable: false },
  },
]

export function explainRiderError(raw: string | null | undefined): ExplainedRiderError {
  const text = raw ?? ''
  for (const { match, value } of RULES) {
    if (match.test(text)) return value
  }
  return {
    kind: 'unknown',
    message: 'Could not save that. It will retry automatically.',
    retryable: true,
  }
}
