import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { explainSignUpError } from './errors'

describe('explainSignUpError — the two that actually happened', () => {
  /**
   * OBSERVED, not imagined. supabase-js against staging, signing up with a
   * phone already on a profile:
   *
   *   AuthRetryableFetchError status=500 "Database error saving new user"
   *
   * There is nothing in that to match on — no code, no field, no mention of a
   * phone. It has to fall through to `unknown` so the caller re-checks the
   * phone and answers with the truth. If this ever starts matching a branch
   * here, the race path silently stops running.
   */
  test('"Database error saving new user" stays unknown, so the caller can re-check the phone', () => {
    const e = explainSignUpError(undefined, 500, 'Database error saving new user')
    assert.equal(e.kind, 'unknown')
    assert.equal(e.field, null)
  })

  /**
   * OBSERVED: AuthApiError status=429 code=over_email_send_rate_limit.
   * Supabase's built-in SMTP allows only a handful of sends per hour across the
   * whole project, so this is what the second shop to register in an hour sees.
   */
  test('the email rate limit is named as temporary and not their fault', () => {
    const e = explainSignUpError('over_email_send_rate_limit', 429, 'email rate limit exceeded')
    assert.equal(e.kind, 'rate_limited')
    assert.equal(e.field, null)
    assert.match(e.message, /try again/i)
  })

  test('any 429 is rate limiting, whatever the code says', () => {
    assert.equal(explainSignUpError(undefined, 429, 'slow down').kind, 'rate_limited')
    assert.equal(explainSignUpError('over_request_rate_limit', 429, '').kind, 'rate_limited')
  })
})

describe('explainSignUpError — the rest', () => {
  test('a duplicate email is a form-level message, not a field one', () => {
    for (const e of [
      explainSignUpError('user_already_exists', 422, 'User already registered'),
      explainSignUpError(undefined, 400, 'User already registered'),
    ]) {
      assert.equal(e.kind, 'email_taken')
      assert.equal(e.field, null)
    }
  })

  /**
   * Supabase refuses `.test` outright — which is the domain every seeded
   * account uses, so it is the first thing somebody copies.
   */
  test('a rejected address lands on the email field', () => {
    for (const e of [
      explainSignUpError('email_address_invalid', 400, 'Email address "a@b.test" is invalid'),
      explainSignUpError(undefined, 400, 'Email address "a@b.test" is invalid'),
    ]) {
      assert.equal(e.kind, 'email_invalid')
      assert.equal(e.field, 'email')
    }
  })

  test('a weak password lands on the password field', () => {
    const e = explainSignUpError('weak_password', 422, 'Password should be at least 6 characters')
    assert.equal(e.kind, 'weak_password')
    assert.equal(e.field, 'password')
  })

  test('anything unrecognised is generic, and never blames a field', () => {
    const e = explainSignUpError('some_new_code', 500, 'kaboom')
    assert.equal(e.kind, 'unknown')
    assert.equal(e.field, null)
    assert.doesNotMatch(e.message, /kaboom/)
  })

  /** The codes are stable; the prose is not. Matching order must reflect that. */
  test('the code wins over the message text', () => {
    // Message mentions a password, but the code says the address was rejected.
    const e = explainSignUpError('email_address_invalid', 400, 'bad password address')
    assert.equal(e.kind, 'email_invalid')
  })

  test('rate limiting is decided before the password fallback', () => {
    // "password" appears, but a 429 is not a password problem.
    assert.equal(explainSignUpError(undefined, 429, 'password rate limit').kind, 'rate_limited')
  })

  test('every branch returns a non-empty message', () => {
    const cases: Array<[string | undefined, number | undefined, string]> = [
      ['user_already_exists', 422, ''],
      ['email_address_invalid', 400, ''],
      ['over_email_send_rate_limit', 429, ''],
      ['weak_password', 422, ''],
      [undefined, 500, 'Database error saving new user'],
    ]
    for (const [c, s, m] of cases) {
      assert.ok(explainSignUpError(c, s, m).message.trim().length > 0, String(c))
    }
  })
})
