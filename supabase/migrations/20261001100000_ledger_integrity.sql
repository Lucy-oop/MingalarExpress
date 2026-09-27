-- ============================================================================
-- 0055. LEDGER INTEGRITY: FOUR GAPS FROM THE CASH-FLOW AUDIT
--
-- ----------------------------------------------------------------------------
-- 1. A MID-RUN DEPOSIT WAS BANKED TWICE
--
-- close_run_and_deposit (0052) deposits the run's cash less deposits TAGGED
-- with the run. remit_cod writes untagged deposits, so if the office took
-- 20,000 from a rider mid-run, closing deposited the full run cash again and
-- the rider's cash went 20,000 negative.
--
-- THE RULE NOW: a deposit taken while the run is out belongs to that run. The
-- close deposits the run's cash less (a) deposits tagged with the run and (b)
-- the rider's untagged deposits made since the run departed. A rider has one
-- open run at a time (trips_rider_open_uk), so no deposit can count for two
-- runs. As a last safety net it is also capped at rider_cash_held, so a close
-- can never drive the rider's cash negative. The board mirrors this figure,
-- so the office confirms exactly what will be banked.
--
-- 2. A SETTLEMENT COULD SPLIT A RUN'S CASH IN TWO
--
-- build_settlement claims every unsettled line up to day end, including the
-- cod_collected of a run still out. The run's deposit then landed later in the
-- NEXT settlement, and cash held read 0 while the rider carried the cash. It
-- now refuses while the rider has a run that can be holding cash: departed or
-- back at the hub, or any open run with a delivered parcel on it.
-- build_settlements_for_day already skips a rider on a 55000 refusal.
--
-- 3. A RUN WITH DELIVERED PARCELS COULD BE CANCELLED
--
-- cancel_trip refused only a CLOSED run. Cancelling one with deliveries left
-- their cash reachable by nothing but a manual deposit, and close_run_and_
-- deposit refuses a cancelled run. Now:
--
--   * a delivered or returned parcel aboard -> refused, always. The run
--     happened; close it.
--   * a run that has LEFT (departed / back at the hub) with a picked-up parcel
--     -> refused: that parcel is on the bike or unreceived.
--   * a run that has NOT left may still be cancelled. Hub parcels loaded onto
--     it (picked_up, delivery leg) go back to the hub pool -- they used to stay
--     attached to the cancelled run, stranded where no pool could see them.
--
-- 4. MANUAL MONEY WAS NOT AUDITED, AND THE LEDGER WAS APPEND-ONLY BY GRANT ONLY
--
--   * Every manual line (adjustment, cod_remitted, platform_fee) now writes an
--     audit_log entry from a trigger, whoever inserts it -- the app's
--     adjustment form wrote none.
--   * Direct inserts are narrowed to reasoned adjustments. Deposits go through
--     remit_cod / close_run_and_deposit, which enforce their caps; a direct
--     cod_remitted insert skipped them.
--   * cod_ledger refuses UPDATE of anything but settlement_id, and DELETE,
--     from EVERYONE -- the revoke only covered app users, not definer code or
--     the service role.
--   * audit_log refuses UPDATE and DELETE from everyone, so an entry, once
--     written, stays.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. close_run_and_deposit: capped at the cash actually held
-- ----------------------------------------------------------------------------
create or replace function public.close_run_and_deposit(
  p_trip_id       uuid,
  p_expected_cash bigint
)
returns public.trips
language plpgsql security definer
set search_path = public
as $$
declare
  v_t     public.trips;
  v_cash  bigint;
  v_done  bigint;
  v_due   bigint;
  v_held  bigint;
  v_code  text;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_t from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  -- 1. The cash this run's deliveries put in the rider's hand, before
  --    close_trip detaches anything.
  select coalesce(sum(l.amount), 0) into v_cash
    from public.cod_ledger l
    join public.orders o on o.id = l.order_id
   where o.trip_id  = p_trip_id
     and o.trip_leg = 'delivery'
     and l.kind     = 'cod_collected'
     and l.rider_id = v_t.rider_id;

  -- Deposits already taken against this run: tagged with it, or (0055) taken
  -- from this rider, untagged, while it was out.
  select coalesce(-sum(l.amount), 0) into v_done
    from public.cod_ledger l
   where l.kind = 'cod_remitted'
     and (l.trip_id = p_trip_id
          or (l.trip_id is null
              and l.rider_id = v_t.rider_id
              and v_t.departed_at is not null
              and l.created_at >= v_t.departed_at));

  v_due := greatest(v_cash - v_done, 0);

  -- 0055: and never more than the rider still carries -- the safety net that
  -- keeps a close from ever driving their cash negative.
  v_held := greatest(public.rider_cash_held(v_t.rider_id), 0);
  v_due  := least(v_due, v_held);

  -- 2. The figure the office confirmed must still be the figure.
  if p_expected_cash is distinct from v_due then
    raise exception 'run_cash_changed: confirmed %, run has %', p_expected_cash, v_due
      using errcode = '55000',
            hint = 'The run''s cash changed since the dialog opened. Refresh and confirm again.';
  end if;

  -- 3. Close: all of close_trip's guards, and the pay line left unsettled.
  v_t := public.close_trip(p_trip_id);

  -- 4. The deposit, in full.
  if v_due > 0 then
    select r.code into v_code from public.routes r where r.id = v_t.route_id;
    insert into public.cod_ledger (order_id, trip_id, rider_id, kind, amount, created_by, memo)
    values (null, p_trip_id, v_t.rider_id, 'cod_remitted', -v_due,
            coalesce(auth.uid(), v_t.rider_id),
            'Run cash handed in · ' || coalesce(v_code, 'run') || ' '
              || to_char(v_t.service_date, 'YYYY-MM-DD'));
  end if;

  perform public.write_audit('trip.close_deposit', 'trips', v_t.id::text, null,
    jsonb_build_object('cash_collected', v_cash,
                       'already_deposited', v_done,
                       'cash_held_before', v_held,
                       'deposited', v_due,
                       'pay_booked', v_t.total_pay));
  return v_t;
end $$;

-- ----------------------------------------------------------------------------
-- 2. build_settlement: not while a run can be holding cash
-- ----------------------------------------------------------------------------
create or replace function public.build_settlement(
  p_rider_id uuid,
  p_date     date default null
) returns public.settlements
language plpgsql security definer
set search_path = public
as $$
declare
  v_s    public.settlements;
  v_date date := coalesce(p_date, public.mm_today());
  v_end  timestamptz;
begin
  if not (public.is_admin() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  /*
    0055: NOT WHILE A RUN CAN BE HOLDING CASH. Claiming a run's cod_collected
    before its deposit exists splits that run across two settlements. A run
    that has left the hub, or any open run with a delivered parcel, may be.
  */
  if exists (
    select 1 from public.trips t
     where t.rider_id = p_rider_id
       and t.status in ('planned', 'loading', 'departed', 'returned')
       and (t.status in ('departed', 'returned')
            or exists (select 1 from public.orders o
                        where o.trip_id = t.id and o.status = 'delivered'))
  ) then
    raise exception 'rider_has_open_run' using errcode = '55000',
      hint = 'Close the rider''s run and deposit its cash before building their settlement.';
  end if;

  v_end := public.mm_day_end(v_date);

  select * into v_s from public.settlements
   where rider_id = p_rider_id and period_date = v_date
   for update;

  if found and v_s.status in ('approved','paid') then
    raise exception 'settlement_locked: %', v_s.status
      using errcode = '55000',
            hint = 'Reverse with an adjustment ledger entry instead of rebuilding.';
  end if;

  if not found then
    insert into public.settlements (rider_id, period_date, status)
    values (p_rider_id, v_date, 'open')
    returning * into v_s;
  end if;

  update public.cod_ledger
     set settlement_id = v_s.id
   where rider_id = p_rider_id
     and settlement_id is null
     and created_at < v_end;

  update public.settlements s set
      gross_cod        = t.gross_cod,
      rider_earnings   = t.rider_earnings,
      delivery_fees    = t.delivery_fees,
      platform_share   = t.delivery_fees - t.rider_earnings,
      net_due_platform = t.net_due,
      order_count      = t.order_count,
      status           = 'submitted'
    from (
      select
        coalesce(sum(l.amount) filter (where l.kind = 'cod_collected'), 0)::bigint  as gross_cod,
        -- CHANGED: trip pay is rider earnings too. Without it a route rider's
        -- settlement shows earnings of zero and platform_share swallows the lot.
        -- 0042: pickup_pay joins them. A per_parcel run books no trip_pay at
        -- all, so without this a rider who spent the morning collecting
        -- settles with those 500s counted as platform_share -- i.e. the
        -- platform keeps the rider's pay. Same failure 0008's header warns
        -- about for trip_pay, one kind later.
        coalesce(-sum(l.amount) filter (
          where l.kind in ('commission_earned','trip_pay','pickup_pay')), 0)::bigint
                                                                                    as rider_earnings,
        coalesce(sum(l.amount), 0)::bigint                                          as net_due,
        coalesce((select sum(f.delivery_fee) from (
                    -- Fees reachable two ways: per-order lines (the pre-route
                    -- path) and whole trips (the route path, where a prepaid
                    -- parcel books no ledger line of its own and would otherwise
                    -- be invisible). DISTINCT over order ids, so a COD parcel on
                    -- a trip is not counted twice.
                    select distinct o.id, o.delivery_fee
                      from public.orders o
                     where o.id in (select l2.order_id from public.cod_ledger l2
                                     where l2.settlement_id = v_s.id and l2.order_id is not null)
                        or (o.status = 'delivered'
                            and o.trip_id in (select l3.trip_id from public.cod_ledger l3
                                               where l3.settlement_id = v_s.id
                                                 and l3.trip_id is not null))
                  ) f), 0)::bigint                                                  as delivery_fees,
        coalesce((select count(*) from (
                    select distinct o.id
                      from public.orders o
                     where o.id in (select l2.order_id from public.cod_ledger l2
                                     where l2.settlement_id = v_s.id and l2.order_id is not null)
                        or (o.status = 'delivered'
                            and o.trip_id in (select l3.trip_id from public.cod_ledger l3
                                               where l3.settlement_id = v_s.id
                                                 and l3.trip_id is not null))
                  ) c), 0)                                                          as order_count
      from public.cod_ledger l
     where l.settlement_id = v_s.id
    ) t
   where s.id = v_s.id
   returning s.* into v_s;

  update public.orders o
     set cod_status = 'settled'
   where o.cod_status in ('collected','remitted')
     and exists (select 1 from public.cod_ledger l
                  where l.order_id = o.id and l.settlement_id = v_s.id);

  perform public.write_audit('settlement.build', 'settlements', v_s.id::text,
                             null, to_jsonb(v_s));
  return v_s;
end $$;

-- ----------------------------------------------------------------------------
-- 3. cancel_trip: not with delivered or collected parcels aboard
-- ----------------------------------------------------------------------------
create or replace function public.cancel_trip(p_trip_id uuid, p_reason text)
returns public.trips
language plpgsql security definer
set search_path = public
as $$
declare v_t public.trips;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_t from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;
  if v_t.status = 'closed' then
    raise exception 'trip_already_closed' using errcode = '55000';
  end if;

  /*
    0055: A RUN THAT DELIVERED, OR IS CARRYING, PARCELS HAPPENED. Delivered
    cash belongs to close_run_and_deposit, which refuses a cancelled run; a
    picked-up parcel on a run that has left is on the bike. Close it instead.
  */
  if exists (select 1 from public.orders o
              where o.trip_id = p_trip_id
                and (o.status in ('delivered', 'returned')
                     or (o.status = 'picked_up' and v_t.status in ('departed', 'returned')))) then
    raise exception 'trip_has_delivered_parcels' using errcode = '55000',
      hint = 'This run has delivered or collected parcels. Close it instead of cancelling.';
  end if;

  -- 0055: a run that never left gives its hub parcels back to the hub pool
  -- (trip_id null, still picked_up, picked_up_at kept) instead of stranding
  -- them on the cancelled run.
  update public.orders
     set trip_id = null, trip_leg = null
   where trip_id = p_trip_id and status = 'picked_up';

  -- Parcels go back to the unrouted pool rather than being cancelled with the
  -- trip: the customer is still waiting, only the run is off.
  update public.orders
     set trip_id = null, trip_leg = null, status = 'pending'
   where trip_id = p_trip_id and status in ('pending','assigned');

  update public.trips
     set status = 'cancelled',
         notes  = coalesce(notes || E'\n', '') || coalesce(p_reason, '')
   where id = p_trip_id
  returning * into v_t;

  perform public.write_audit('trip.cancel', 'trips', v_t.id::text, null,
                             jsonb_build_object('reason', p_reason));
  return v_t;
end $$;


-- ----------------------------------------------------------------------------
-- 4a. Every manual ledger line is audited, whoever writes it
-- ----------------------------------------------------------------------------
create or replace function public.tg_cod_ledger_audit_manual()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.kind in ('adjustment', 'cod_remitted', 'platform_fee') then
    perform public.write_audit('ledger.' || new.kind::text, 'cod_ledger', new.id::text, null,
      jsonb_build_object('rider_id',   new.rider_id,
                         'amount',     new.amount,
                         'memo',       new.memo,
                         'order_id',   new.order_id,
                         'trip_id',    new.trip_id,
                         'created_by', new.created_by));
  end if;
  return new;
end $$;

comment on function public.tg_cod_ledger_audit_manual is
  'Writes an audit_log entry for every manual ledger line (adjustment, '
  'cod_remitted, platform_fee), however it was inserted (0055).';

drop trigger if exists cod_ledger_audit_manual on public.cod_ledger;
create trigger cod_ledger_audit_manual after insert on public.cod_ledger
for each row execute function public.tg_cod_ledger_audit_manual();

-- ----------------------------------------------------------------------------
-- 4b. Direct inserts: reasoned adjustments only
-- ----------------------------------------------------------------------------
drop policy if exists cod_insert_admin on public.cod_ledger;
create policy cod_insert_admin on public.cod_ledger
  for insert to authenticated
  with check (
    public.is_admin()
    and kind = 'adjustment'
    and created_by = auth.uid()
    and length(trim(coalesce(memo, ''))) >= 3
  );

-- An adjustment without a reason is refused however it arrives. NOT VALID so
-- any historical line is left as it was; every new one is checked.
alter table public.cod_ledger drop constraint if exists cod_ledger_adjustment_reason;
alter table public.cod_ledger
  add constraint cod_ledger_adjustment_reason
  check (kind <> 'adjustment' or length(trim(coalesce(memo, ''))) >= 3) not valid;

-- ----------------------------------------------------------------------------
-- 4c. cod_ledger: append-only for everyone
-- ----------------------------------------------------------------------------
create or replace function public.tg_cod_ledger_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'cod_ledger_append_only' using errcode = '42501',
      hint = 'Ledger lines are never deleted. Book an adjustment instead.';
  end if;
  -- The one legitimate UPDATE: a settlement claiming (or a deleted
  -- settlement releasing) the line.
  if (to_jsonb(new) - 'settlement_id') is distinct from (to_jsonb(old) - 'settlement_id') then
    raise exception 'cod_ledger_append_only' using errcode = '42501',
      hint = 'Ledger lines are never edited. Book an adjustment instead.';
  end if;
  return new;
end $$;

drop trigger if exists cod_ledger_append_only on public.cod_ledger;
create trigger cod_ledger_append_only before update or delete on public.cod_ledger
for each row execute function public.tg_cod_ledger_append_only();

-- ----------------------------------------------------------------------------
-- 4d. audit_log: immutable for everyone
-- ----------------------------------------------------------------------------
create or replace function public.tg_audit_log_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_log_immutable' using errcode = '42501',
    hint = 'Audit entries are never edited or deleted.';
end $$;

drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable before update or delete on public.audit_log
for each row execute function public.tg_audit_log_immutable();

-- The new functions follow 0054: nothing is PUBLIC's.
revoke execute on function public.tg_cod_ledger_audit_manual() from public;
revoke execute on function public.tg_cod_ledger_append_only() from public;
revoke execute on function public.tg_audit_log_immutable() from public;
