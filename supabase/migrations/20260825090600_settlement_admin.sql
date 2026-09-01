-- ============================================================================
--  MINGALAR EXPRESS  ·  0006 — SETTLEMENT LIFECYCLE + ADMIN AGGREGATES
--
--  Phase 1 built the ledger and `build_settlement`. This migration adds the
--  pieces the Super Admin panel needs to actually run a day's money:
--
--    remit_cod            interim cash deposit during a shift
--    approve_settlement   submitted -> approved
--    mark_settlement_paid approved  -> paid
--    reopen_settlement    approved  -> submitted  (the one reverse gear)
--    cod_positions        per-rider open vs settled, for the audit explorer
--    cod_by_shop          per-shop COD position, derived from orders
--
--  How the money actually clears
--  ----------------------------
--  `rider_cod_in_hand` is defined as sum(amount) over ledger rows with
--  settlement_id IS NULL. So a rider's balance is cleared the moment
--  `build_settlement` CLAIMS their rows — not when the settlement is approved or
--  paid. Approval and payment then track the physical cash and the payout, which
--  are a separate concern from the book.
--
--  `remit_cod` exists for the other case: a rider hands in cash mid-shift,
--  before any settlement is built, because their float is near the ceiling and
--  dispatch has stopped offering them COD work (the `cod_limit` block in
--  lib/geo/dispatch.ts). It books a negative line so their headroom recovers
--  immediately.
-- ============================================================================

set check_function_bodies = off;

-- ----------------------------------------------------------------------------
-- 1. remit_cod — rider hands cash in
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

  v_before := public.rider_cod_in_hand(p_rider_id);
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

  v_after := public.rider_cod_in_hand(p_rider_id);

  perform public.write_audit('cod.remit', 'cod_ledger', p_rider_id::text,
    jsonb_build_object('cash_in_hand', v_before),
    jsonb_build_object('cash_in_hand', v_after, 'amount', p_amount));

  return v_after;
end $$;


-- ----------------------------------------------------------------------------
-- 2. Settlement state transitions
--
--    open -> submitted   (build_settlement)
--    submitted -> approved -> paid
--    approved -> submitted (reopen, audited)
--
--  Terminal on purpose: a `paid` settlement is never edited. Corrections are
--  booked as a new 'adjustment' ledger line, which is what a ledger is for.
-- ----------------------------------------------------------------------------

create or replace function public.approve_settlement(p_id uuid)
returns public.settlements
language plpgsql security definer set search_path = public
as $$
declare v_s public.settlements;
begin
  if not (public.is_admin() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_s from public.settlements where id = p_id for update;
  if not found then raise exception 'settlement_not_found' using errcode = 'P0002'; end if;
  if v_s.status <> 'submitted' then
    raise exception 'settlement_not_approvable: %', v_s.status using errcode = '55000';
  end if;

  update public.settlements
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_id returning * into v_s;

  perform public.write_audit('settlement.approve', 'settlements', p_id::text, null, to_jsonb(v_s));
  return v_s;
end $$;

create or replace function public.mark_settlement_paid(p_id uuid, p_note text default null)
returns public.settlements
language plpgsql security definer set search_path = public
as $$
declare v_s public.settlements;
begin
  if not (public.is_admin() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_s from public.settlements where id = p_id for update;
  if not found then raise exception 'settlement_not_found' using errcode = 'P0002'; end if;
  if v_s.status <> 'approved' then
    raise exception 'settlement_not_payable: %', v_s.status using errcode = '55000';
  end if;

  update public.settlements
     set status = 'paid',
         paid_at = now(),
         notes = coalesce(nullif(trim(p_note), ''), notes)
   where id = p_id returning * into v_s;

  perform public.write_audit('settlement.paid', 'settlements', p_id::text, null, to_jsonb(v_s));
  return v_s;
end $$;

create or replace function public.reopen_settlement(p_id uuid, p_reason text)
returns public.settlements
language plpgsql security definer set search_path = public
as $$
declare v_s public.settlements;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_s from public.settlements where id = p_id for update;
  if not found then raise exception 'settlement_not_found' using errcode = 'P0002'; end if;
  if v_s.status <> 'approved' then
    raise exception 'settlement_not_reopenable: %', v_s.status using errcode = '55000';
  end if;

  update public.settlements
     set status = 'submitted', approved_by = null, approved_at = null,
         notes = concat_ws(' | ', notes, 'Reopened: ' || trim(p_reason))
   where id = p_id returning * into v_s;

  perform public.write_audit('settlement.reopen', 'settlements', p_id::text,
                             jsonb_build_object('reason', p_reason), to_jsonb(v_s));
  return v_s;
end $$;


-- ----------------------------------------------------------------------------
-- 3. build_settlements_for_day — one call for the whole fleet
--
--  Every rider who booked a ledger line that is still unclaimed. `build_settlement`
--  is itself idempotent, so re-running a day is safe.
-- ----------------------------------------------------------------------------

create or replace function public.build_settlements_for_day(p_date date default null)
returns setof public.settlements
language plpgsql security definer set search_path = public
as $$
declare
  v_date date := coalesce(p_date, public.mm_today());
  v_rider uuid;
begin
  if not (public.is_admin() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for v_rider in
    select distinct l.rider_id
      from public.cod_ledger l
     where l.settlement_id is null
       and l.created_at < public.mm_day_end(v_date)
  loop
    -- A rider whose settlement is already locked is skipped, not fatal: one
    -- approved rider must not stop the rest of the fleet being drafted.
    begin
      return next public.build_settlement(v_rider, v_date);
    exception when sqlstate '55000' then
      continue;
    end;
  end loop;
end $$;


-- ----------------------------------------------------------------------------
-- 4. cod_positions — the audit explorer's rider view
-- ----------------------------------------------------------------------------

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


-- ----------------------------------------------------------------------------
-- 5. cod_by_shop — the shop side of the same money
--
--  DERIVED FROM ORDERS, NOT FROM A LEDGER. There is no shop-side double entry in
--  this schema: the rider ledger is the book of record for cash the platform is
--  owed, and what the platform in turn owes each shop is currently computed.
--
--  That is a deliberate limit, not an oversight. If shop payouts ever need to be
--  reconciled, disputed or paid in instalments, they need their own ledger and
--  settlement tables — do not bolt state onto this function.
--
--  goods_value = cod_amount minus the delivery fee when the CUSTOMER paid it
--  (see the column comment on orders.cod_amount).
-- ----------------------------------------------------------------------------

create or replace function public.cod_by_shop(p_from date default null, p_to date default null)
returns table (
  shop_id        uuid,
  shop_name      text,
  owner_name     text,
  delivered      bigint,
  in_transit     bigint,
  cod_collected  bigint,
  goods_value    bigint,
  platform_fees  bigint,
  owed_to_shop   bigint
)
language sql stable security invoker
set search_path = public
as $$
  with bounds as (
    select public.mm_day_start(coalesce(p_from, public.mm_today() - 30)) as starts_at,
           public.mm_day_end(coalesce(p_to, public.mm_today()))         as ends_at
  )
  select
    s.id,
    s.name,
    p.full_name,
    count(*) filter (where o.status = 'delivered'),
    count(*) filter (where o.status in ('assigned','picked_up')),
    coalesce(sum(o.cod_amount) filter (where o.status = 'delivered'), 0)::bigint,
    coalesce(sum(
      case when o.status <> 'delivered' then 0
           when o.payment_method <> 'cod' then 0
           when o.fee_payer = 'customer' then o.cod_amount - o.delivery_fee
           else o.cod_amount
      end), 0)::bigint,
    coalesce(sum(o.delivery_fee) filter (where o.status = 'delivered'), 0)::bigint,
    coalesce(sum(
      case when o.status <> 'delivered' then 0
           when o.payment_method <> 'cod' then -o.delivery_fee
           when o.fee_payer = 'customer' then o.cod_amount - o.delivery_fee
           else o.cod_amount - o.delivery_fee
      end), 0)::bigint
  from public.shops s
  join public.profiles p on p.id = s.owner_id
  cross join bounds b
  left join public.orders o on o.shop_id = s.id
        and o.created_at >= b.starts_at and o.created_at < b.ends_at
  group by s.id, s.name, p.full_name
  order by s.name;
$$;


-- ----------------------------------------------------------------------------
-- 6. admin_overview — Super Admin dashboard KPIs in one round trip
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
    'in_flight_now',     (select count(*) from public.orders
                           where status in ('assigned','picked_up')),
    'cod_outstanding',   (select coalesce(sum(amount), 0) from public.cod_ledger
                           where settlement_id is null),
    'fees_today',        (select coalesce(sum(delivery_fee), 0) from public.orders
                           where status = 'delivered' and delivered_at >= public.mm_day_start(v_today)),
    'rider_earnings_today', (select coalesce(-sum(amount), 0) from public.cod_ledger
                              where kind = 'commission_earned'
                                and created_at >= public.mm_day_start(v_today)),
    'settlements_open',  (select count(*) from public.settlements where status = 'submitted'),
    'settlements_unpaid',(select count(*) from public.settlements where status = 'approved'),
    'riders_over_float', (select count(*) from public.rider_profiles r
                           where public.rider_cod_in_hand(r.id) >= r.cod_float_limit
                             and r.cod_float_limit > 0)
  );
end $$;


-- ----------------------------------------------------------------------------
-- 7. GRANTS
-- ----------------------------------------------------------------------------

grant execute on function
  public.remit_cod(uuid, bigint, text),
  public.approve_settlement(uuid),
  public.mark_settlement_paid(uuid, text),
  public.reopen_settlement(uuid, text),
  public.build_settlements_for_day(date),
  public.cod_positions(),
  public.cod_by_shop(date, date),
  public.admin_overview()
to authenticated;

revoke execute on function
  public.remit_cod(uuid, bigint, text),
  public.approve_settlement(uuid),
  public.mark_settlement_paid(uuid, text),
  public.reopen_settlement(uuid, text),
  public.build_settlements_for_day(date),
  public.cod_positions(),
  public.cod_by_shop(date, date),
  public.admin_overview()
from anon;
