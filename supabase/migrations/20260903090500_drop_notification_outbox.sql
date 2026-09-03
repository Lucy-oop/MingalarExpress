-- ============================================================================
--  MINGALAR EXPRESS  ·  0016 — REMOVE THE AUTOMATED SMS SYSTEM
--
--  0014 built an outbox that texted a shop when a parcel failed. It worked --
--  verified end to end on staging -- and it is being removed anyway, because
--  the operation chose a human loop instead:
--
--    the rider phones the office        (Telegram / Viber / a call)
--    the office phones the shop         and records the decision for them
--
--  That is a better fit at this volume. Nobody in Yangon is waiting on an SMS
--  when the office can ring the shop and settle it in thirty seconds, and it
--  removes a per-segment cost, a gateway dependency and a sender-ID
--  registration that had not yet cleared.
--
--  THE LOOP IS NOT LEFT OPEN. What the outbox raised, `/admin/orders` already
--  shows: the "Waiting on a shop" saved view is exactly the set of parcels that
--  failed, detached from a run, with no decision recorded. The office works that
--  list. Removing the messages removes the prompt, not the visibility.
--
--  WHAT IS DELIBERATELY KEPT. Everything from 0011 stays: orders.resolution,
--  resolve_failed_order(), order_attempt_count() and
--  app_settings.max_delivery_attempts. The shop's three answers and the retry
--  ceiling are the workflow; the SMS was only ever how the question got asked.
--
--  IF THIS COMES BACK. Do not rewrite it from scratch -- read commit c501237.
--  The part that is not obvious is the cost arithmetic: a Burmese SMS is UCS-2
--  at 70 characters a segment, a Burmese customer name forces UCS-2 even in an
--  otherwise English message, and a link over ~36 characters silently pushes
--  every message into a third segment.
--
--  Forward-only. 0014 stays in the tree as history: it is applied and recorded
--  on staging, and deleting the file would leave a fresh database and staging
--  permanently disagreeing about whether the table exists.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. The hook into the order lifecycle, first
--
--  Before the functions it calls, so no window exists where a failing parcel
--  reaches a trigger whose callee has gone.
-- ----------------------------------------------------------------------------

drop trigger if exists orders_notify on public.orders;
drop function if exists public.tg_orders_notify();


-- ----------------------------------------------------------------------------
-- 2. The worker's verbs and the enqueue path
-- ----------------------------------------------------------------------------

drop function if exists public.claim_notifications(integer);
drop function if exists public.complete_notification(bigint, text, text);
drop function if exists public.fail_notification(bigint, text, boolean);
drop function if exists public.enqueue_notification(text, uuid, text, jsonb);
drop function if exists public.notify_send_after(timestamptz);


-- ----------------------------------------------------------------------------
-- 3. The outbox
--
--  CASCADE takes its indexes, its touch trigger and its RLS policy with it.
--  Any queued messages go too: they were never sent, and there is nobody left
--  to send them.
-- ----------------------------------------------------------------------------

drop table if exists public.notification_outbox cascade;


-- ----------------------------------------------------------------------------
-- 4. Settings
--
--  max_delivery_attempts is NOT in this list. It belongs to 0011 and still
--  governs how many times close_trip re-pools a failed parcel before holding it
--  for the shop -- which is now the office's cue to pick up the phone.
-- ----------------------------------------------------------------------------

alter table public.app_settings
  drop column if exists notifications_enabled,
  drop column if exists notify_quiet_from,
  drop column if exists notify_quiet_until,
  drop column if exists notify_max_attempts;
