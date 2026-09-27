-- ============================================================================
-- 0053. CASH IN HAND AND UNSETTLED EARNINGS ARE TWO NUMBERS
--
-- The office's model (0052): a rider hands in 100% of the cash every run and is
-- paid their earnings at the monthly settlement. The two never offset. But
-- every screen that showed a rider's money showed ONE figure -- the sum of all
-- unsettled ledger lines -- so after a run was closed and deposited the rider
-- read as "holding" MINUS their pay, and a rider carrying cash with a lot of
-- pay owed looked like they carried nothing.
--
-- Two figures from here on, from the same ledger:
--
--   CASH IN HAND        cod_collected + cod_remitted, unsettled
--                       (rider_cash_held, 0041 -- unchanged). 0 once every
--                       run is closed and deposited.
--   UNSETTLED EARNINGS  what the platform owes the rider:
--                       -(commission_earned + trip_pay + pickup_pay), less any
--                       adjustment or platform_fee lines -- a shortfall booked
--                       against a rider comes off their pay, not their cash.
--                       rider_unsettled_earnings, new.
--
-- rider_cod_in_hand STAYS THE NET, as 0041 documented and route_flow R10a
-- asserts: it is what a settlement balances to. What changes is who reads it.
-- The two checks that meant CASH now read cash:
--
--   remit_cod          a deposit is capped at the cash actually held, not at
--                      cash minus pay (which refused a full deposit whenever
--                      pay was owed)
--   admin_overview     "riders over their cash float" compares CASH to the
--                      float
--
-- cod_positions gains cash_in_hand and unsettled_earnings, for the Riders table
-- and the audit screen; rider_earnings_summary gains unsettled_earnings for the
-- rider app.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. rider_unsettled_earnings
-- ----------------------------------------------------------------------------
create or replace function public.rider_unsettled_earnings(p_rider_id uuid)
returns bigint language plpgsql stable security definer set search_path = public
as $$
begin
  -- Same guard as rider_cash_held: a rider may read their own, the office anyone's.
  if p_rider_id is distinct from auth.uid()
     and not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Earnings lines are negative (owed to the rider); adjustments are signed
  -- the same way as everything else, so one negated sum gives "owed to rider".
  return coalesce((
    select -sum(l.amount)
      from public.cod_ledger l
     where l.rider_id = p_rider_id
       and l.settlement_id is null
       and l.kind in ('commission_earned', 'trip_pay', 'pickup_pay', 'adjustment', 'platform_fee')
  ), 0)::bigint;
end $$;

comment on function public.rider_unsettled_earnings is
  'What the platform owes a rider and has not settled: run pay, parcel pay and '
  'commission, less adjustments booked against them. Never includes cash -- see '
  'rider_cash_held for that, and 0053 for why the two are kept apart.';

grant execute on function public.rider_unsettled_earnings(uuid) to authenticated;
revoke execute on function public.rider_unsettled_earnings(uuid) from anon;

-- ----------------------------------------------------------------------------
-- 2. remit_cod: capped at the cash held
-- ----------------------------------------------------------------------------
create or replace function public.remit_cod(
  p_rider_id uuid,
  p_amount   bigint,
  p_memo     text default null
) returns bigint
language plpgsql security definer
set search_path = public
as $$
declare v_before bigint; v_after bigint;
begin
  if not (public.is_admin() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_must_be_positive' using errcode = '22023';
  end if;

  v_before := public.rider_cash_held(p_rider_id);
  if p_amount > v_before then
    -- Refusing an over-deposit is deliberate: a rider cannot hand in more than
    -- they are holding, and letting it through would leave a negative float that
    -- silently raises their COD headroom above the real limit.
    raise exception 'amount_exceeds_cash_in_hand: holding %, offered %', v_before, p_amount
      using errcode = '55000';
  end if;

  -- Negative: reduces what the rider owes the platform.
  insert into public.cod_ledger (rider_id, kind, amount, memo, created_by)
  values (p_rider_id, 'cod_remitted', -p_amount,
          coalesce(nullif(trim(p_memo), ''), 'Cash handed in'), auth.uid());

  v_after := public.rider_cash_held(p_rider_id);

  perform public.write_audit('cod.remit', 'cod_ledger', p_rider_id::text,
    jsonb_build_object('cash_in_hand', v_before),
    jsonb_build_object('cash_in_hand', v_after, 'amount', p_amount));

  return v_after;
end $$;

-- ----------------------------------------------------------------------------
-- 3. admin_overview: the float warning compares cash
-- ----------------------------------------------------------------------------
create or replace function public.admin_overview()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_today date := public.mm_today();
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'riders_total',      (select count(*) from public.rider_profiles),
    'riders_online',     (select count(*) from public.rider_profiles where is_online),
    'riders_inactive',   (select count(*) from public.rider_profiles r
                           join public.profiles p on p.id = r.id where not p.is_active),
    'shops_total',       (select count(*) from public.shops),
    'shops_inactive',    (select count(*) from public.shops where not is_active),
    'areas_total',       (select count(*) from public.service_areas where is_active),
    'orders_today',      (select count(*) from public.orders
                           where created_at >= public.mm_day_start(v_today)),
    'delivered_today',   (select count(*) from public.orders
                           where status = 'delivered' and delivered_at >= public.mm_day_start(v_today)),
    'pending_now',       (select count(*) from public.orders where status = 'pending'),
    'unrouted_now',      (select count(*) from public.orders
                           where status = 'pending' and trip_id is null),
    'in_flight_now',     (select count(*) from public.orders
                           where status in ('assigned','picked_up')),
    'cod_outstanding',   (select coalesce(sum(amount), 0) from public.cod_ledger
                           where settlement_id is null),
    'fees_today',        (select coalesce(sum(delivery_fee), 0) from public.orders
                           where status = 'delivered' and delivered_at >= public.mm_day_start(v_today)),
    -- 0008: both kinds, "or a route-only day reports zero rider cost and the
    -- dashboard shows a margin that does not exist."
    -- 0047: all THREE. The same sentence was true again the moment 0042 added
    -- pickup_pay -- "Platform share today" is fees minus this, so every 500 Ks
    -- of collection pay was being counted as profit.
    'rider_earnings_today', (select coalesce(-sum(amount), 0) from public.cod_ledger
                              where kind in ('commission_earned','trip_pay','pickup_pay')
                                and created_at >= public.mm_day_start(v_today)),
    'trip_pay_today',    (select coalesce(-sum(amount), 0) from public.cod_ledger
                           where kind = 'trip_pay'
                             and created_at >= public.mm_day_start(v_today)),
    'trips_today',       (select count(*) from public.trips where service_date = v_today),
    'trips_open',        (select count(*) from public.trips
                           where status in ('planned','loading','departed')),
    -- Runs that went out short. The point of the override is that somebody can
    -- see how often it is being used.
    'trips_short_today', (select count(*) from public.trips
                           where service_date = v_today
                             and depart_override_reason is not null),
    'settlements_open',  (select count(*) from public.settlements where status = 'submitted'),
    'settlements_unpaid',(select count(*) from public.settlements where status = 'approved'),
    'riders_over_float', (select count(*) from public.rider_profiles r
                           where public.rider_cash_held(r.id) >= r.cod_float_limit
                             and r.cod_float_limit > 0)
  );
end $$;

-- ----------------------------------------------------------------------------
-- 4. cod_positions: both figures, as columns of their own
--
-- Appended at the END, so no positional reader moves. A new column changes the
-- signature, hence drop-and-create, as 0047 had to.
-- ----------------------------------------------------------------------------
drop function if exists public.cod_positions();

create or replace function public.cod_positions()
returns table (
  rider_id        uuid,
  full_name       text,
  phone           text,
  base_area       text,
  is_active       boolean,
  cod_collected   bigint,
  cod_remitted    bigint,
  commission      bigint,
  trip_pay        bigint,
  pickup_pay      bigint,
  adjustments     bigint,
  open_balance    bigint,
  settled_total   bigint,
  cod_float_limit bigint,
  open_since      timestamptz,
  last_entry_at   timestamptz,
  entry_count     bigint,
  cash_in_hand       bigint,
  unsettled_earnings bigint
)
language sql stable security invoker
set search_path = public
as $$
  select
    r.id,
    p.full_name,
    p.phone,
    a.name,
    p.is_active,
    coalesce(sum(l.amount) filter (where l.kind = 'cod_collected'), 0)::bigint,
    coalesce(-sum(l.amount) filter (where l.kind = 'cod_remitted'), 0)::bigint,
    coalesce(-sum(l.amount) filter (where l.kind = 'commission_earned'), 0)::bigint,
    coalesce(-sum(l.amount) filter (where l.kind = 'trip_pay'), 0)::bigint,
    -- 0047. Was inside open_balance and in no column, so the breakdown did not
    -- reconcile to the total beside it.
    coalesce(-sum(l.amount) filter (where l.kind = 'pickup_pay'), 0)::bigint,
    coalesce(sum(l.amount) filter (where l.kind in ('adjustment','platform_fee')), 0)::bigint,
    coalesce(sum(l.amount) filter (where l.settlement_id is null), 0)::bigint,
    coalesce(sum(l.amount) filter (where l.settlement_id is not null), 0)::bigint,
    r.cod_float_limit,
    min(l.created_at) filter (where l.settlement_id is null),
    max(l.created_at),
    count(l.id),
    -- 0053. Cash the rider is carrying: the two cash kinds, unsettled.
    coalesce(sum(l.amount) filter (where l.settlement_id is null
                                     and l.kind in ('cod_collected','cod_remitted')), 0)::bigint,
    -- 0053. What the rider is owed: earnings less adjustments, unsettled.
    coalesce(-sum(l.amount) filter (where l.settlement_id is null
                                      and l.kind in ('commission_earned','trip_pay','pickup_pay',
                                                     'adjustment','platform_fee')), 0)::bigint
  from public.rider_profiles r
  join public.profiles p on p.id = r.id
  left join public.service_areas a on a.id = r.base_area_id
  left join public.cod_ledger l on l.rider_id = r.id
  group by r.id, p.full_name, p.phone, a.name, p.is_active, r.cod_float_limit
  order by coalesce(sum(l.amount) filter (where l.settlement_id is null), 0) desc,
           p.full_name;
$$;

grant execute on function public.cod_positions() to authenticated;
revoke execute on function public.cod_positions() from anon;

-- ----------------------------------------------------------------------------
-- 5. rider_earnings_summary: the rider's own unsettled earnings
-- ----------------------------------------------------------------------------
create or replace function public.rider_earnings_summary(p_rider_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public
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
      'cash_held',        public.rider_cash_held(v_rider),
      -- 0053: what the rider is owed at the next settlement, apart from cash.
      'unsettled_earnings', public.rider_unsettled_earnings(v_rider),
      -- 0042: pickup_pay joins the pay kinds. This is the number the owner
      -- asked to move as the rider works, and it now does.
      'earned_today',     coalesce((select -sum(l.amount) from public.cod_ledger l
                                    where l.rider_id = v_rider
                                      and l.kind in ('commission_earned','trip_pay','pickup_pay')
                                      and l.created_at >= public.mm_day_start(v_today)), 0),
      'earned_week',      coalesce((select -sum(l.amount) from public.cod_ledger l
                                    where l.rider_id = v_rider
                                      and l.kind in ('commission_earned','trip_pay','pickup_pay')
                                      and l.created_at >= public.mm_day_start(v_today - 6)), 0),
      'trip_pay_today',   coalesce((select -sum(l.amount) from public.cod_ledger l
                                    where l.rider_id = v_rider and l.kind = 'trip_pay'
                                      and l.created_at >= public.mm_day_start(v_today)), 0),
      'delivered_today',  coalesce((select count(*) from public.orders o
                                    where o.rider_id = v_rider and o.status = 'delivered'
                                      and o.delivered_at >= public.mm_day_start(v_today)), 0),
      -- 0041: from the append-only event trail, because trip_leg flips to
      -- 'delivery' when the office sorts the shelf and erased this.
      'picked_up_today',  coalesce((select count(*)
                                      from public.order_status_events e
                                      join public.orders o on o.id = e.order_id
                                     where e.to_status = 'picked_up'
                                       and e.created_at >= public.mm_day_start(v_today)
                                       and (e.actor_id = v_rider or o.rider_id = v_rider)), 0),
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


comment on function public.cod_positions is
  'One row per rider: the ledger broken down by kind, the net open_balance, and '
  '(0053) cash_in_hand and unsettled_earnings as separate figures -- cash the '
  'rider is carrying, and pay owed to them. Screens show those two, never the net.';
