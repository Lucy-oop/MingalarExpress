/**
 * Money bounds shared by the validator and the UI.
 *
 * Extracted so the browser can refuse a figure the server would reject, without
 * pulling Zod into the client bundle — `lib/orders/booking.ts` runs in the form
 * and needs the same ceiling that `mmk` enforces in `lib/validation/schemas.ts`.
 *
 * Two numbers that read as one and are not:
 *
 *   MAX_MMK is the ceiling on the GOODS value the shop types.
 *   `orders.cod_amount` stores goods PLUS the delivery fee when the customer
 *   pays it, so the stored figure can legitimately exceed this by the fee.
 *
 * That gap is why `createOrder` re-checks the collectable TOTAL after the route
 * fee is known: at schema time `deliveryFee` is still a placeholder zero, so the
 * schema cannot see it. Without that second check a 50,000,000 parcel on a
 * 4,000 route stores 50,004,000 — a value this file's own maximum would reject
 * if it were ever read back through a form.
 */
export const MAX_MMK = 50_000_000
