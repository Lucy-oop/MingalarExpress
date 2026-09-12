-- ============================================================================
-- 0047. THE TWO PAY-KIND READERS 0042 MISSED
--
-- ----------------------------------------------------------------------------
-- THE PATTERN, NOT THE TYPO
--
-- Six functions enumerate `cod_ledger.kind` by name. 0042 added `pickup_pay`
-- and updated four of them -- `build_settlement`, `close_trip`,
-- `rider_earnings_summary`, `tg_orders_audit` -- and missed these two, whose
-- latest definition is still 0008. 0042's own header called this out as the
-- fragility of the change ("five lists that must agree") and then missed two
-- of the five, which is the argument for the test that ships beside this file
-- rather than for being more careful next time.
--
-- ----------------------------------------------------------------------------
-- 1. cod_positions: the columns did not add up to the balance
--
-- The audit explorer at /admin/audit is where the office reconciles what a
-- rider is holding. It returns a breakdown -- cod_collected, cod_remitted,
-- commission, trip_pay, adjustments -- alongside `open_balance`.
--
-- `open_balance` is `sum(l.amount) where settlement_id is null`: a RAW SUM
-- OVER EVERY KIND, so pickup pay was always inside it. But no column exposed
-- it, and `adjustments` filters only ('adjustment','platform_fee'). So the
-- breakdown silently failed to reconcile to the total it sits next to, by
-- exactly the rider's pickup pay.
--
-- On a reconciliation screen that is the worst shape of wrong: nothing errors,
-- the total is right, and the columns explaining it do not add up -- so the
-- first person to check the arithmetic stops trusting the screen rather than
-- finding the bug.
--
-- A NEW COLUMN CHANGES THE SIGNATURE, so this is drop-and-create, exactly as
-- 0008 itself had to be when it split `trip_pay` out of `commission`. The
-- ordering of existing columns is unchanged so no positional reader moves.
--
-- ----------------------------------------------------------------------------
-- 2. admin_overview: "Platform share today" overstated profit
--
-- `rider_earnings_today` fed the one profit figure in the product --
-- `fees_today - rider_earnings_today` on /admin/super -- and omitted pickup
-- pay, so the tile read high by whatever the day's collections cost. Measured
-- on this project when there was data: the tile said 4,800 Ks against a true
-- 800 Ks.
--
-- The comment immediately above that line is from the last time this happened,
-- when trip_pay was added: "or a route-only day reports zero rider cost and
-- the dashboard shows a margin that does not exist." It was right twice.
--
-- Both bodies below are 0008's, copied verbatim except for the filters named
-- here and the new column. Reconstructing a function body from memory is how
-- 0042 nearly dropped `period_date` and the settlement_locked guard out of
-- build_settlement.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. cod_positions — pickup pay gets a column of its own
--
--    Its own column rather than folded into `commission`, for the reason 0008
--    gives for splitting out trip_pay: they are different pay models, and an
--    auditor comparing a rider against the fee schedule needs to know which
--    one they are looking at. Collections and deliveries are now paid
--    separately, so a rider's row has both.
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
  entry_count     bigint
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
    count(l.id)
  from public.rider_profiles r
  join public.profiles p on p.id = r.id
  left join public.service_areas a on a.id = r.base_area_id
  left join public.cod_ledger l on l.rider_id = r.id
  group by r.id, p.full_name, p.phone, a.name, p.is_active, r.cod_float_limit
  order by coalesce(sum(l.amount) filter (where l.settlement_id is null), 0) desc,
           p.full_name;
$$;

comment on function public.cod_positions is
  'Per-rider COD position for the audit explorer. The pay columns -- commission, '
  'trip_pay, pickup_pay -- together with cod_collected, cod_remitted and '
  'adjustments must reconcile to open_balance, which is a raw sum over every '
  'kind. Adding a ledger kind without adding it here breaks that silently; '
  'supabase/migrations/pay-kinds.test.ts is what catches it.';

-- ----------------------------------------------------------------------------
-- 2. admin_overview — rider cost includes what collections cost
--
--    0008's body, unchanged but for the one filter. jsonb return, so no
--    signature change and no drop.
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
                           where public.rider_cod_in_hand(r.id) >= r.cod_float_limit
                             and r.cod_float_limit > 0)
  );
end $$;

grant execute on function public.cod_positions() to authenticated;
revoke execute on function public.cod_positions() from anon;
