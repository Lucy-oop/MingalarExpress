import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { codCollectable } from '@/lib/pricing'
import {
  bookingBlocker,
  bookingPayment,
  bookingReady,
  parseAmount,
  type BookingGate,
} from './booking'
import { MAX_MMK } from '@/lib/validation/limits'

/** A parcel that is ready to book, so each test can spoil exactly one thing. */
const READY: BookingGate = {
  pinInServiceArea: true,
  pickupInServiceArea: true,
  addressLength: 24,
  hasArea: true,
  needsAmount: true,
  amount: { ok: true, value: 45_000 },
}

describe('bookingReady — the regression this module exists for', () => {
  /**
   * THE BUG. `canSubmit` never mentioned the amount, so an empty field booked a
   * COD parcel as PREPAID: the rider collected nothing, the customer kept the
   * goods, and cod_by_shop billed the shop the delivery fee. A prepaid parcel is
   * a legitimate thing, so nothing downstream could tell the difference.
   */
  test('an empty amount with prepaid unticked cannot be booked', () => {
    const gate = { ...READY, amount: parseAmount('') }
    assert.equal(bookingReady(gate), false)
    assert.equal(bookingBlocker(gate), 'amount_empty')
  })

  test('and neither can a typed zero', () => {
    const gate = { ...READY, amount: parseAmount('0') }
    assert.equal(bookingReady(gate), false)
    assert.equal(bookingBlocker(gate), 'amount_empty')
  })

  /** Prepaid is the tick, and only the tick. */
  test('an empty amount is fine when none is asked for', () => {
    const gate = { ...READY, needsAmount: false, amount: parseAmount('') }
    assert.equal(bookingReady(gate), true)
    assert.equal(bookingBlocker(gate), null)
  })

  test('a real amount books', () => {
    assert.equal(bookingReady(READY), true)
    assert.equal(bookingBlocker(READY), null)
  })
})

describe('bookingBlocker — one reason, in the order a shop would fix them', () => {
  const cases: Array<[string, Partial<BookingGate>, string]> = [
    ['the shop is outside the area', { pickupInServiceArea: false }, 'pickup_outside'],
    ['pin outside the area', { pinInServiceArea: false }, 'pin_outside'],
    ['address too short', { addressLength: 4 }, 'no_address'],
    ['no area chosen', { hasArea: false }, 'no_area'],
  ]

  for (const [name, patch, expected] of cases) {
    test(name, () => {
      assert.equal(bookingBlocker({ ...READY, ...patch }), expected)
    })
  }

  /**
   * The shop's own pickup point is the one thing they cannot fix on this page —
   * it lives in shop settings — so it is reported before anything they could act
   * on here, rather than after they have filled the whole form.
   */
  test('the unfixable-here problem is reported first', () => {
    const everythingWrong: BookingGate = {
      pinInServiceArea: false,
      pickupInServiceArea: false,
      addressLength: 0,
      hasArea: false,
      needsAmount: true,
      amount: parseAmount(''),
    }
    assert.equal(bookingBlocker(everythingWrong), 'pickup_outside')
  })

  test('the address is asked for before the area, and both before the money', () => {
    assert.equal(bookingBlocker({ ...READY, addressLength: 0, hasArea: false }), 'no_address')
    assert.equal(
      bookingBlocker({ ...READY, hasArea: false, amount: parseAmount('') }),
      'no_area',
    )
  })
})

describe('parseAmount — what the shop typed, or why it will not do', () => {
  test('a plain figure', () => {
    assert.deepEqual(parseAmount('45000'), { ok: true, value: 45_000 })
  })

  /** How people actually write kyat. Nothing ambiguous about either. */
  test('thousands separators are accepted', () => {
    assert.deepEqual(parseAmount('45,000'), { ok: true, value: 45_000 })
    assert.deepEqual(parseAmount('45 000'), { ok: true, value: 45_000 })
    assert.deepEqual(parseAmount(' 45000 '), { ok: true, value: 45_000 })
  })

  /**
   * THE THREE DIVERGENCES. Each of these used to preview one thing and be
   * rejected by the server as another — the negative was the worst, because the
   * preview called it "prepaid, nothing to collect" and then the server errored
   * on a field it had just said was fine.
   */
  test('a decimal is named as a decimal, not silently mangled', () => {
    // Stripping non-digits would turn this into 450005 — ten times the amount,
    // with nothing on screen to say so. Hence a refusal, not a sanitiser.
    assert.deepEqual(parseAmount('45000.5'), { ok: false, reason: 'decimal' })
    assert.deepEqual(parseAmount('.5'), { ok: false, reason: 'decimal' })
  })

  test('a negative is a negative, not a prepaid parcel', () => {
    assert.deepEqual(parseAmount('-5'), { ok: false, reason: 'negative' })
  })

  test('exponent notation is refused rather than expanded', () => {
    assert.deepEqual(parseAmount('1e9'), { ok: false, reason: 'not_a_number' })
    assert.deepEqual(parseAmount('abc'), { ok: false, reason: 'not_a_number' })
  })

  test('the ceiling matches the schema, to the kyat', () => {
    assert.deepEqual(parseAmount(String(MAX_MMK)), { ok: true, value: MAX_MMK })
    assert.deepEqual(parseAmount(String(MAX_MMK + 1)), { ok: false, reason: 'too_large' })
  })

  /** Number() loses precision on a long digit run before it exceeds any bound. */
  test('an absurd digit run does not slip through as a safe integer', () => {
    assert.deepEqual(parseAmount('9'.repeat(40)), { ok: false, reason: 'too_large' })
  })

  test('empty is its own reason, not an error', () => {
    assert.deepEqual(parseAmount(''), { ok: false, reason: 'empty' })
    assert.deepEqual(parseAmount('   '), { ok: false, reason: 'empty' })
  })
})

describe('bookingPayment — what actually gets posted', () => {
  test('a COD parcel posts the goods value and keeps the chosen fee payer', () => {
    assert.deepEqual(bookingPayment('nothing', parseAmount('45000'), 'customer'), {
      paymentMethod: 'cod',
      goodsValue: 45_000,
      feePayer: 'customer',
    })
    assert.deepEqual(bookingPayment('nothing', parseAmount('45000'), 'shop').feePayer, 'shop')
  })

  /**
   * `cod_by_shop` bills the shop the delivery fee on ANY non-COD parcel,
   * ignoring fee_payer entirely. Storing 'customer' would be a row that
   * contradicts the query that reads it.
   */
  test('a prepaid parcel records that the shop pays the fee, because it does', () => {
    assert.deepEqual(bookingPayment('all', parseAmount(''), 'customer'), {
      paymentMethod: 'prepaid',
      goodsValue: 0,
      feePayer: 'shop',
    })
  })

  test('ticking prepaid discards whatever was typed', () => {
    assert.equal(bookingPayment('all', parseAmount('45000'), 'customer').goodsValue, 0)
    assert.equal(bookingPayment('all', parseAmount('45000'), 'customer').paymentMethod, 'prepaid')
  })

  /**
   * Mirrors the two refinements in orderCreateSchema and the SQL constraint
   * `orders_cod_consistent`: cod ⇒ amount > 0, prepaid ⇒ amount = 0. Whatever
   * this function returns has to satisfy both, or the shop gets a validation
   * error about a field they never saw.
   */
  /**
   * THE CONSTRAINT IS ON `cod_amount`, NOT ON THE GOODS VALUE, and this test
   * used to conflate them — `goodsValue > 0` was a fine proxy while a COD
   * parcel always carried goods.
   *
   * The 'product' case is exactly where they part company: goods 0, and
   * `cod_amount = codCollectable(0, fee, 'customer') = fee`. That is what makes
   * it legal under `orders_cod_consistent` (`cod` demands `cod_amount > 0`) and
   * why it needs no migration, so the real figure is what has to be checked.
   */
  test('every reachable output satisfies orders_cod_consistent', () => {
    const FEE = 4000
    for (const paid of ['nothing', 'product', 'all'] as const) {
      for (const raw of ['', '0', '1', '45000', 'abc', '-5']) {
        const p = bookingPayment(paid, parseAmount(raw), 'customer')
        const codAmount =
          p.paymentMethod === 'cod' ? codCollectable(p.goodsValue, FEE, p.feePayer) : 0
        const consistent =
          (p.paymentMethod === 'cod' && codAmount > 0) ||
          (p.paymentMethod === 'prepaid' && codAmount === 0)
        // An unusable amount is blocked by bookingBlocker before it can be
        // posted, so only the reachable combinations must hold.
        const reachable = bookingReady({
          ...READY,
          needsAmount: paid === 'nothing',
          amount: parseAmount(raw),
        })
        if (reachable) {
          assert.ok(
            consistent,
            `paid=${paid} raw=${JSON.stringify(raw)} -> ${JSON.stringify(p)} cod=${codAmount}`,
          )
        }
      }
    }
  })

  /**
   * THE CASE THE BOOLEAN COULD NOT SAY. A customer pays the shop for the
   * product and leaves the delivery fee for the door. The rider collects the
   * fee and nothing else.
   */
  test("'product' posts a COD parcel that collects the fee alone", () => {
    const p = bookingPayment('product', parseAmount(''), 'shop')
    assert.deepEqual(p, { paymentMethod: 'cod', goodsValue: 0, feePayer: 'customer' })
    // fee_payer is 'customer' whatever the shop's select said, because that IS
    // what this option means — they are paying it at the door.
    assert.equal(codCollectable(p.goodsValue, 4000, p.feePayer), 4000)
  })

  test("and it needs no amount, while 'nothing' still does", () => {
    assert.equal(bookingBlocker({ ...READY, needsAmount: false, amount: parseAmount('') }), null)
    assert.notEqual(bookingBlocker({ ...READY, needsAmount: true, amount: parseAmount('') }), null)
  })

  /**
   * The settlement identity this rests on, asserted here so the arithmetic is
   * pinned next to the thing that produces it: with fee_payer 'customer',
   * `owed_to_shop` and `goods_value` are both `cod_amount - delivery_fee`, so a
   * fee-only collection owes the shop nothing and books the whole amount as our
   * fee.
   */
  test('a fee-only collection leaves the shop owed nothing', () => {
    const FEE = 4000
    const p = bookingPayment('product', parseAmount(''), 'customer')
    const codAmount = codCollectable(p.goodsValue, FEE, p.feePayer)
    assert.equal(codAmount - FEE, 0, 'goods_value and owed_to_shop must both be zero')
  })
})

describe('a shop with no map pin can still book', () => {
  /**
   * THE DEAD END THIS PINS.
   *
   * 0034 let a shop register with no map pin and 0036 let it book, because two
   * thirds of Yangon addresses do not geocode and the alternative was a
   * merchant who could never sell anything. The booking form then computed
   * `pickupOutside = !isInServiceArea(pickup)` on a null pickup, which is
   * false-y in the wrong direction — so this gate answered 'pickup_outside'
   * before every other clause, and the shop was told IT was outside our
   * delivery area with no way to fix it from that screen.
   *
   * The form now passes `pickupInServiceArea: true` when there is no pin: not
   * knowing where a shop is is not the same as knowing it is outside.
   */
  test('no pin is not "pickup outside"', () => {
    assert.equal(bookingBlocker({ ...READY, pickupInServiceArea: true }), null)
  })

  /** And a pin that IS outside still blocks, because that one is real. */
  test('but a pin genuinely outside the area still does', () => {
    assert.equal(
      bookingBlocker({ ...READY, pickupInServiceArea: false }),
      'pickup_outside',
    )
  })

  /**
   * The DROPOFF is untouched by any of this: the customer's location is chosen
   * on a map at booking time, `orders.dropoff_lat` is still NOT NULL, and a
   * delivery with nowhere to go is not a parcel.
   */
  test('the customer still needs a pin, inside the area', () => {
    assert.equal(bookingBlocker({ ...READY, pinInServiceArea: false }), 'pin_outside')
  })
})

describe('a delivery address needs no map pin', () => {
  /**
   * 0037. A shop types a customer's address out of a Viber message, and
   * Nominatim finds two of six Yangon addresses — so requiring a pin required
   * the shop to GUESS about a street it has never visited. A guessed pin is not
   * more information than none; it is worse, because a rider trusts it.
   *
   * `dropoffAreaId` is the locator now, and the better one: a pin said
   * "somewhere in Greater Yangon", an area says "South Okkalapa, which Route C
   * visits, priced 4,000". `orders_dropoff_locatable` keeps at least one.
   */
  test('no pin books, as long as there is an area', () => {
    assert.equal(bookingBlocker({ ...READY, pinInServiceArea: true, hasArea: true }), null)
  })

  /** The area is what cannot be skipped — nothing prices or routes without it. */
  test('but no area still blocks', () => {
    assert.equal(bookingBlocker({ ...READY, hasArea: false }), 'no_area')
  })

  /**
   * A pin that IS dropped and lands outside Greater Yangon is a mistake the
   * shop just made and can immediately correct, and
   * `orders_dropoff_in_service_area` refuses the row regardless.
   */
  test('a dropped pin outside the area still blocks', () => {
    assert.equal(bookingBlocker({ ...READY, pinInServiceArea: false }), 'pin_outside')
  })

  /** The address is still what the rider reads, so it is still required. */
  test('and the address is still required', () => {
    assert.equal(bookingBlocker({ ...READY, addressLength: 2 }), 'no_address')
  })
})
