-- ============================================================================
--  DIRECT ASSIGNMENT  —  what survived the offer engine (0009)
--
--  Replaces offer_flow.sql. The offer/accept negotiation is gone; the parts of
--  it that were never about offers are kept here:
--
--    * assign_order's lock discipline (README rule 7) — Route Local ad-hoc drops
--      and reassigning a failed parcel still go through it
--    * order_assignments as read-only history
--    * rider_earnings_summary self-scoping (was O11)
--
--  Plus the guard 0009 added: a parcel on a trip is the trip's, and the
--  per-parcel path must not touch it.
--
--  Run after rls_smoke.sql on a clean seeded DB.
-- ============================================================================
\set ON_ERROR_STOP on

\echo '=== A1. a shop cannot assign a rider ==='
select set_config('request.jwt.claims','{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',false);
set role authenticated;
do $$
begin
  perform public.assign_order(
    (select id from public.orders where status='pending' order by created_at limit 1),
    '44444444-4444-4444-4444-444444444444');
  raise exception 'FAIL: a shop assigned a rider';
exception when insufficient_privilege then
  raise notice 'PASS: assign_order refused a shop_owner';
end $$;
reset role;

\echo '=== A2. dispatcher assigns; commission snapshotted, history written ==='
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',false);
set role authenticated;
do $$
declare oid uuid; o public.orders; h record;
begin
  select id into oid from public.orders where status='pending' order by created_at limit 1;
  o := public.assign_order(oid, '44444444-4444-4444-4444-444444444444');

  if o.status <> 'assigned' then raise exception 'FAIL: status %', o.status; end if;
  -- 80% of the 2,500 route fee for Lhay Htaung Kan (ROUTE_LOCAL). Snapshotted
  -- at assignment (decision D5) so a later repricing cannot rewrite it.
  if o.rider_commission_amount <> 2000 then
    raise exception 'FAIL: commission %, expected 2000', o.rider_commission_amount;
  end if;
  if o.rider_commission_amount + o.platform_fee_amount <> o.delivery_fee then
    raise exception 'FAIL: split does not sum to the fee';
  end if;

  select * into h from public.order_assignments
   where order_id = oid and rider_id = '44444444-4444-4444-4444-444444444444';
  if h.response <> 'accepted' then
    raise exception 'FAIL: history response %, expected accepted', h.response;
  end if;
  raise notice 'PASS: assigned, 2000/500 split snapshotted, history row written';
end $$;

\echo '=== A3. the same order cannot be assigned twice ==='
--  This is the race, made deterministic: the second caller sees the status the
--  first one committed. In a live dispatch room the loser blocks on the row lock
--  first, then fails here — the whole point of SELECT ... FOR UPDATE.
do $$
declare oid uuid;
begin
  select id into oid from public.orders
   where status='assigned' and rider_id='44444444-4444-4444-4444-444444444444' limit 1;
  perform public.assign_order(oid, '55555555-5555-5555-5555-555555555555');
  raise exception 'FAIL: an assigned order was reassigned without unassigning';
exception when sqlstate '55000' then
  raise notice 'PASS: assign_order refused an already-assigned parcel';
end $$;
reset role;

\echo '=== A4. nobody but assign_order writes assignment history ==='
--  Revoked at the GRANT layer in 0009, not merely unmatched by a policy, so the
--  attempt fails outright instead of silently affecting zero rows.
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',false);
set role authenticated;
do $$
begin
  insert into public.order_assignments (order_id, rider_id, response, offered_by)
  values ((select id from public.orders limit 1),
          '66666666-6666-6666-6666-666666666666', 'pending',
          '22222222-2222-2222-2222-222222222222');
  raise exception 'FAIL: a dispatcher forged assignment history';
exception when insufficient_privilege then
  raise notice 'PASS: order_assignments INSERT refused even for dispatch';
end $$;
do $$
begin
  update public.order_assignments set response = 'rejected';
  raise exception 'FAIL: assignment history was edited';
exception when insufficient_privilege then
  raise notice 'PASS: order_assignments UPDATE refused';
end $$;
reset role;

\echo '=== A5. a parcel on a trip cannot be assigned per-parcel ==='
--  The 0009 guard. load_trip never takes a capacity slot (0007 §10), so letting
--  assign_order take one for the same parcel would leave active_order_count
--  permanently high once the trip released it.
select set_config('request.jwt.claims','',false);
do $$
declare t public.trips; ids uuid[]; oid uuid;
begin
  t := public.plan_trip((select id from public.routes where code = 'ROUTE_LOCAL'));
  select array_agg(o.id) into ids from (
    select id from public.orders where status = 'pending' and trip_id is null limit 1) o;
  if ids is null then raise exception 'FAIL: no pending parcel to load'; end if;
  oid := ids[1];
  t := public.load_trip(t.id, ids, 'delivery');

  begin
    perform public.assign_order(oid, '55555555-5555-5555-5555-555555555555');
    raise exception 'FAIL: a trip parcel was assigned per-parcel';
  exception when sqlstate '55000' then
    raise notice 'PASS: assign_order refused a parcel already on a run';
  end;

  -- ...and the trip parcel still consumed no rider capacity.
  if (select active_order_count from public.rider_profiles
       where id='55555555-5555-5555-5555-555555555555') <> 0 then
    raise exception 'FAIL: the refused assignment moved the capacity counter';
  end if;
  perform public.cancel_trip(t.id, 'test fixture');
end $$;

\echo '=== A6. rider_earnings_summary is self-scoped ==='
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}',false);
set role authenticated;
do $$
declare j jsonb;
begin
  j := public.rider_earnings_summary();
  if (j->>'active_orders')::int <> 1 then
    raise exception 'FAIL: active_orders is %, expected 1', j->>'active_orders';
  end if;
  raise notice 'PASS: own summary reads: cash=% earned_today=% active=%',
    j->>'cod_in_hand', j->>'earned_today', j->>'active_orders';
end $$;
do $$
begin
  perform public.rider_earnings_summary('55555555-5555-5555-5555-555555555555');
  raise exception 'FAIL: read another rider''s earnings';
exception when insufficient_privilege then
  raise notice 'PASS: cannot read another rider''s earnings';
end $$;

\echo '=== A7. a rider sees only their own parcels (no offer branch left) ==='
--  0009 reduced orders_read_rider to `rider_id = auth.uid()`. rider2 holds
--  nothing, so rider2 sees nothing — where before, an offer aimed at them would
--  have made a stranger's parcel visible.
select set_config('request.jwt.claims','{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}',false);
do $$
declare n int;
begin
  select count(*) into n from public.orders;
  if n <> 0 then raise exception 'FAIL: rider2 sees % parcels they do not hold', n; end if;
  raise notice 'PASS: rider2 sees no parcels at all';
end $$;
reset role;
select set_config('request.jwt.claims','',false);

\echo ''
\echo '####  ALL ASSIGNMENT CHECKS PASSED  ####'
