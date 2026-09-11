-- ============================================================================
-- 0045. WHO DID IT — the name behind a status event, for the shop that sent it
--
-- The shop's feed says "8 parcels collected". It could not say BY WHOM,
-- because `profiles_read_self_or_dispatch` lets a shop owner read exactly one
-- profile: their own. Joining `profiles` from the feed query returns nothing
-- and the shop sees a bare UUID or, as today, no name at all.
--
-- This is the same wall `order_rider_card` was written against in 0021, and
-- this is its sibling. Two differences, both deliberate:
--
--   IT KEYS ON THE EVENT, NOT THE ORDER. `orders.rider_id` is who has the
--   parcel NOW. A collection notification must name whoever actually collected
--   it, and once the office reloads that parcel onto a delivery run,
--   `orders.rider_id` is somebody else. `order_status_events.actor_id` is
--   stamped at the transition and never changes — the same reasoning 0041 used
--   when it moved `picked_up_today` onto this table.
--
--   IT TAKES A BATCH AND FILTERS, WHERE order_rider_card TAKES ONE AND RAISES.
--   A feed asks about every event on screen at once; one id the caller cannot
--   see is a row to omit, not grounds to fail the whole panel and blank the
--   bell. Authorisation is unchanged in strength — it is the same predicate,
--   applied per row.
--
-- NO PHONE, matching order_rider_card exactly and for its stated reason:
-- chasing a delivery goes through dispatch, not direct to the rider.
--
-- A definer function bypasses RLS, so it re-authorises for itself against the
-- same test the `orders` policies apply.
-- ============================================================================

create or replace function public.event_actor_names(p_event_ids bigint[])
returns table (event_id bigint, full_name text)
language sql stable security definer
set search_path = public
as $$
  select e.id, p.full_name
    from public.order_status_events e
    join public.orders o   on o.id = e.order_id
    join public.profiles p on p.id = e.actor_id
   where e.id = any(p_event_ids)
     and (public.owns_shop(o.shop_id)
          or o.rider_id = auth.uid()
          or public.is_dispatch()
          or public.is_service_ctx());
$$;

comment on function public.event_actor_names is
  'Full name of whoever caused each status event, for the shop that sent the '
  'parcel. Keys on the EVENT, not the order: orders.rider_id is who holds the '
  'parcel now, while actor_id is who did the thing being reported. Omits rows '
  'the caller may not see rather than raising, so one unreadable id cannot '
  'blank a whole feed. Excludes the phone, as order_rider_card does.';

grant execute on function public.event_actor_names(bigint[]) to authenticated;
revoke execute on function public.event_actor_names(bigint[]) from anon;
