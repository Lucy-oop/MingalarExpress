import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

/**
 * The public tracking page now serves a delivery photo, which was a deliberate
 * widening of a payload whose own docblock says not to widen it. These guards
 * hold the two halves of that decision apart: the part the owner chose (the
 * photo is public), and the part that must not drift with it (how it is
 * served, and what else is exposed).
 */
const page = readFileSync('app/track/[code]/page.tsx', 'utf8')
const proof = readFileSync('components/orders/delivery-proof.tsx', 'utf8')
const rpc = readFileSync('supabase/migrations/20260918100000_track_proof.sql', 'utf8')

describe('the public payload stayed narrow apart from the photo', () => {
  /**
   * Codes come from a global sequence and are enumerable, so every field here
   * is readable by a stranger. The photo was added knowingly; these were not,
   * and adding one would be a leak rather than a decision.
   */
  test('no phone, address, rider or money reached the tracking RPC', () => {
    const body = rpc.slice(rpc.indexOf('create or replace function'))
    const code = body.replace(/--.*$/gm, '')
    for (const field of [
      'customer_phone',
      'dropoff_address',
      'pickup_address',
      'rider_id',
      'cod_amount',
      'delivery_fee',
    ]) {
      assert.ok(
        !code.includes(field),
        `track_order now returns ${field} — anyone who can guess a code can read it`,
      )
    }
  })

  /**
   * A failed delivery can still carry a photo from an earlier attempt, and
   * that is not something a tracking page should serve.
   */
  test('the photo is returned only on a delivered parcel', () => {
    assert.match(
      rpc,
      /case when o\.status = 'delivered' then o\.proof_photo_path else null end/,
      'the proof path is returned unconditionally — including on failed parcels',
    )
  })
})

describe('how the photo is served', () => {
  /**
   * THE CHANGE SOMEBODY WILL REACH FOR, and the one that must never land.
   *
   * `delivery-proofs` is private and its only read policy is `to authenticated`
   * (0004). The page signs one object server-side with the service role and
   * sends only the link. Giving `anon` a storage policy instead would "fix" the
   * same symptom and expose EVERY proof in the bucket to a guessed path —
   * strictly worse than the decision that was actually made.
   */
  test('anon was never granted storage access', () => {
    for (const f of readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(`supabase/migrations/${f}`, 'utf8').replace(/--.*$/gm, '')
      if (!/delivery-proofs/.test(sql)) continue
      const anonPolicy =
        /create policy[\s\S]{0,300}?to anon[\s\S]{0,300}?delivery-proofs/.test(sql) ||
        /delivery-proofs[\s\S]{0,300}?for select to anon/.test(sql)
      assert.ok(!anonPolicy, `${f} grants anon read on delivery-proofs — every proof is now public`)
    }
  })

  /** The path is useless without a signature; it must not reach the client. */
  test('the page signs server-side and passes only the URL', () => {
    assert.match(page, /createSignedUrl\(path, 300\)/, 'the proof link is no longer short-lived')
    assert.match(page, /url=\{proofUrl\}/, 'the component is being handed something other than a URL')
    assert.ok(
      !/url=\{order\.proof_photo_path\}/.test(page),
      'the raw object path is being sent to the browser',
    )
  })

  test('the component accepts a URL and nothing else', () => {
    assert.match(proof, /\{ url \}: \{ url: string \| null \}/)
    assert.ok(!/createSignedUrl/.test(proof), 'the client component is trying to sign — it has no session')
  })
})

describe('the delivered step', () => {
  /** Evidence belongs on the checkpoint it is evidence of. */
  test('the photo hangs off the delivered node, once it has happened', () => {
    const timeline = readFileSync('components/orders/status-timeline.tsx', 'utf8')
    assert.match(timeline, /step\.status === 'delivered' && step\.done \? deliveredSlot : null/)
  })

  /**
   * A delivered parcel with no photo is ordinary — older rows predate
   * `orders_delivered_needs_proof`, and a KBZPay receipt is stored separately.
   * Rendering nothing leaves a gap that looks like a layout bug.
   */
  test('a missing photo says so instead of collapsing', () => {
    assert.match(proof, /track\.proofNone/, 'the empty state is gone — the timeline will just have a hole')
  })

  test('it can be enlarged and closed', () => {
    assert.match(proof, /track\.proofEnlarge/, 'the tap-to-enlarge affordance is gone')
    assert.match(proof, /<Overlay/, 'the lightbox is gone — Overlay carries Escape and the backdrop')
    assert.match(proof, /aria-label=\{t\('track\.proofClose'\)\}/, 'the explicit close button is gone')
  })
})
