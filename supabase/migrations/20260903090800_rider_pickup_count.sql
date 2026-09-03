-- ============================================================================
--  MINGALAR EXPRESS  ·  0019 — "HOW MANY DID I COLLECT TODAY?"
--
--  The rider dashboard showed deliveries completed and nothing about pickups,
--  although the rider is paid per pickup (app_settings.route_pickup_rate, 500)
--  separately from per parcel. So a rider on a collection-heavy run saw a low
--  "delivered" figure and no evidence of the other half of their day.
--
--  One field added. Everything else is 0008's body unchanged -- and that
--  matters: 0005 defined this function first and 0008 REDEFINED it to fold trip
--  pay into `earned_today` and add `trip_pay_today`. Splicing the 0005 body
--  would silently revert both, which is exactly what the first draft of this
--  migration did. route_flow R7b caught it: "earned_today 0, expected 18600".
--
--  A `pickup` leg is counted at `picked_up_at`, the moment it is on the bike and
--  the moment the rider has earned the 500.
--
--  Forward-only.
-- ============================================================================

set check_function_bodies = off;

create or replace function public.rider_earnings_summary(p_rider_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_rider uuid := coalesce(p_rider_id, auth.uid());
  v_today date := public.mm_today();
begin
  if v_rider is distinct from auth.uid() and not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'cod_in_hand',      public.rider_cod_in_hand(v_rider),
      -- CHANGED: both kinds. A route rider earning only trip_pay saw 0 here.
      'earned_today',     coalesce((select -sum(l.amount) from public.cod_ledger l
                                    where l.rider_id = v_rider
                                      and l.kind in ('commission_earned','trip_pay')
                                      and l.created_at >= public.mm_day_start(v_today)), 0),
      'earned_week',      coalesce((select -sum(l.amount) from public.cod_ledger l
                                    where l.rider_id = v_rider
                                      and l.kind in ('commission_earned','trip_pay')
                                      and l.created_at >= public.mm_day_start(v_today - 6)), 0),
      'trip_pay_today',   coalesce((select -sum(l.amount) from public.cod_ledger l
                                    where l.rider_id = v_rider and l.kind = 'trip_pay'
                                      and l.created_at >= public.mm_day_start(v_today)), 0),
      'delivered_today',  coalesce((select count(*) from public.orders o
                                    where o.rider_id = v_rider and o.status = 'delivered'
                                      and o.delivered_at >= public.mm_day_start(v_today)), 0),
      -- Collections completed today. A `pickup` leg is a parcel carried FROM a
      -- shop back to the hub, and the rider is paid per pickup (500) separately
      -- from per parcel -- so "how many did I collect" is a figure they are owed
      -- money against, not a curiosity.
      'picked_up_today',  coalesce((select count(*) from public.orders o
                                    where o.rider_id = v_rider
                                      and o.trip_leg = 'pickup'
                                      and o.picked_up_at >= public.mm_day_start(v_today)), 0),
      'active_orders',    coalesce((select count(*) from public.orders o
                                    where o.rider_id = v_rider
                                      and o.status in ('assigned','picked_up')), 0),
      'active_trip',      (select jsonb_build_object(
                                    'id', t.id, 'route', r.code, 'colour', r.colour,
                                    'status', t.status, 'service_date', t.service_date)
                             from public.trips t join public.routes r on r.id = t.route_id
                            where t.rider_id = v_rider
                              and t.status in ('planned','loading','departed')
                            limit 1),
      'unsettled_since',  (select min(l.created_at) from public.cod_ledger l
                            where l.rider_id = v_rider and l.settlement_id is null)
    )
  );
end $$;
