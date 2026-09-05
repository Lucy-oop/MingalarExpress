import { COD_ADVANCE_POLICY_VERSION } from './cod-advance'

/**
 * The two decisions behind a blocking policy step, kept pure because both are
 * the kind of thing that goes wrong silently and takes the whole panel with it.
 */

/**
 * What the acceptance read actually found.
 *
 * `none` and `unknown` used to be the same value — a bare `null` — which was
 * fine while the terms were a dismissible prompt and is fatal for a gate. "They
 * have not accepted" and "we could not tell" call for opposite answers: one
 * blocks, the other must not.
 */
export type AcceptanceRead =
  | { status: 'accepted'; version: string }
  | { status: 'none' }
  | { status: 'unknown' }

/**
 * Does this shop have to stop and read the terms?
 *
 * FAILS OPEN, deliberately, and this is the single guard against locking every
 * shop out of every page at once. The read can fail for reasons that have
 * nothing to do with the shop — the table missing because a migration has not
 * been pushed, a transient connection error — and behind a hard gate each of
 * those would block the whole panel, with a Continue button failing for exactly
 * the same reason the read did. A database blip must not cost a shop their day.
 *
 * The cost of failing open is a shop that slips through without accepting.
 * That is recoverable: they are asked on the next page load that works. A
 * lockout is not recoverable by anyone except us.
 */
export function shouldBlock(
  read: AcceptanceRead,
  currentVersion: string = COD_ADVANCE_POLICY_VERSION,
): boolean {
  if (read.status === 'unknown') return false
  if (read.status === 'none') return true
  // An acceptance of superseded wording is not an acceptance of this one.
  return read.version !== currentVersion
}

/**
 * Slack, in CSS pixels, for the scroll-to-end test.
 *
 * `scrollTop` is fractional on a zoomed or high-DPI display, and a container
 * whose content ends on a half pixel never reports an exact match. Without this
 * the checkbox would simply never enable for those users — which is its own
 * lockout, and a maddening one, because nothing on screen would explain it.
 */
const SCROLL_SLACK_PX = 24

/**
 * Has the reader reached the bottom of the document?
 *
 * Returns true when the content is SHORTER than its container. There is no
 * bottom to scroll to in that case, so requiring one would make a short
 * document — or a tall desktop window — impossible to accept.
 */
export function isScrolledToEnd(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  slack: number = SCROLL_SLACK_PX,
): boolean {
  if (!Number.isFinite(scrollTop) || !Number.isFinite(clientHeight) || !Number.isFinite(scrollHeight)) {
    // Nothing measurable to gate on. Refusing here would strand the reader.
    return true
  }
  if (scrollHeight <= clientHeight) return true
  return scrollTop + clientHeight >= scrollHeight - slack
}
