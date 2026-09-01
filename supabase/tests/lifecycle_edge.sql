-- ============================================================================
--  PHASE 1 — LIFECYCLE EDGE CASES
--  Unassign, prepaid ledger asymmetry, negative settlement, retry-after-fail,
--  stale heartbeat, capacity saturation. Run after rls_smoke.sql on a clean DB.
-- ============================================================================
\set ON_ERROR_STOP on
\echo '=== E1. unassign (assigned -> pending) releases capacity and wipes the split ==='
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',false);
set role authenticated;
do $$
declare oid uuid; o public.orders; ac smallint;
begin
  select id into oid from public.orders where status='pending' order by created_at limit 1;
  o := public.assign_order(oid, '55555555-5555-5555-5555-555555555555');
  select active_order_count into ac from public.rider_profiles where id='55555555-5555-5555-5555-555555555555';
  if ac <> 1 then raise exception 'FAIL: capacity not taken (%)', ac; end if;

  update public.orders set status='pending' where id=oid;
  select * into o from public.orders where id=oid;
  select active_order_count into ac from public.rider_profiles where id='55555555-5555-5555-5555-555555555555';

  if o.rider_id is not null then raise exception 'FAIL: rider_id survived unassign'; end if;
  if o.rider_commission_amount is not null then raise exception 'FAIL: commission survived unassign'; end if;
  if o.cod_status <> 'none' then raise exception 'FAIL: cod_status is %', o.cod_status; end if;
  if ac <> 0 then raise exception 'FAIL: capacity not released (%)', ac; end if;
  raise notice 'PASS: unassign is clean, capacity released';
end $$;

\echo '=== E2. prepaid delivery: commission-only ledger, negative net ==='
do $$
declare oid uuid; o public.orders;
begin
  select id into oid from public.orders where payment_method='prepaid' and status='pending' limit 1;
  o := public.assign_order(oid, '55555555-5555-5555-5555-555555555555');
  o := public.advance_order(oid,'picked_up');
  o := public.advance_order(oid,'delivered',null,null, oid::text||'/p.webp','U Tin Maung');
  if o.cod_status <> 'none' then raise exception 'FAIL: prepaid cod_status %', o.cod_status; end if;
  raise notice 'PASS: prepaid delivered, cod_status=none, fee=% commission=%',
    o.delivery_fee, o.rider_commission_amount;
end $$;
do $$
declare hand bigint; legs int;
begin
  select coalesce(sum(amount),0), count(*) into hand, legs
    from public.cod_ledger where rider_id='55555555-5555-5555-5555-555555555555' and settlement_id is null;
  if legs <> 1 then raise exception 'FAIL: expected 1 ledger leg for prepaid, got %', legs; end if;
  if hand >= 0 then raise exception 'FAIL: platform should owe rider, got %', hand; end if;
  raise notice 'PASS: prepaid = 1 leg, platform owes rider % MMK', -hand;
end $$;

\echo '=== E3. settlement with negative net (platform pays rider) ==='
reset role;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',false);
set role authenticated;
do $$
declare s public.settlements;
begin
  s := public.build_settlement('55555555-5555-5555-5555-555555555555', public.mm_today());
  if s.gross_cod <> 0 then raise exception 'FAIL: gross_cod %', s.gross_cod; end if;
  if s.net_due_platform >= 0 then raise exception 'FAIL: net should be negative, got %', s.net_due_platform; end if;
  if s.rider_earnings <> -s.net_due_platform then raise exception 'FAIL: earnings/net mismatch'; end if;
  raise notice 'PASS: negative settlement, platform owes rider % MMK', -s.net_due_platform;
end $$;
reset role;

\echo '=== E4. failed -> reassign to another rider ==='
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',false);
set role authenticated;
do $$
declare oid uuid; o public.orders; ac1 smallint; ac2 smallint;
begin
  insert into public.orders (shop_id, pickup_address,pickup_lat,pickup_lng,
    customer_name,customer_phone,dropoff_address,dropoff_lat,dropoff_lng,
    parcel_desc,payment_method,cod_amount,delivery_fee,created_by)
  select id,pickup_address,pickup_lat,pickup_lng,'Retry Customer','+959791110000',
    'Kyaung Kone Rd, Thingangyun',16.8500,96.1880,'retry parcel','cod',5000,1800,owner_id
  from public.shops where id='aaaaaaaa-0000-0000-0000-000000000001' returning id into oid;

  o := public.assign_order(oid,'44444444-4444-4444-4444-444444444444');
  o := public.advance_order(oid,'failed',null,null,null,null,'customer not home');
  select active_order_count into ac1 from public.rider_profiles where id='44444444-4444-4444-4444-444444444444';
  if ac1 <> 0 then raise exception 'FAIL: capacity not released on fail (%)', ac1; end if;

  o := public.assign_order(oid,'55555555-5555-5555-5555-555555555555');
  if o.status <> 'assigned' or o.rider_id <> '55555555-5555-5555-5555-555555555555' then
    raise exception 'FAIL: reassign after failure did not take';
  end if;
  if o.fail_reason is not null then raise exception 'FAIL: stale fail_reason kept'; end if;
  select active_order_count into ac2 from public.rider_profiles where id='55555555-5555-5555-5555-555555555555';
  if ac2 <> 1 then raise exception 'FAIL: new rider capacity not taken (%)', ac2; end if;
  raise notice 'PASS: failed order reassigned cleanly, no double-charge of capacity';
end $$;

\echo '=== E5. an offline rider cannot be given work ==='
--  HONEST NOTE ON WHAT 0009 REMOVED: ping-STALENESS filtering left the system
--  with nearby_available_riders. It only ever lived inside that proximity
--  search, and the route model has no proximity search -- a run's rider is
--  chosen by name at the hub, not by GPS. So a rider whose phone has not
--  reported in for 30 minutes is no longer hidden from anything.
--
--  What assign_order still enforces is the stronger, explicit signal: not
--  online, not available, or at capacity means no work. That is asserted below;
--  the stale-ping case is deliberately no longer claimed.
reset role;
select set_config('request.jwt.claims','',false);
update public.rider_profiles
   set last_ping_at = now() - interval '30 minutes',
       is_online    = false
 where id='44444444-4444-4444-4444-444444444444';
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',false);
set role authenticated;
do $$
declare oid uuid;
begin
  insert into public.orders (shop_id,pickup_address,pickup_lat,pickup_lng,
    customer_name,customer_phone,dropoff_address,dropoff_lat,dropoff_lng,
    parcel_desc,payment_method,cod_amount,delivery_fee,created_by)
  select id,pickup_address,pickup_lat,pickup_lng,'Stale Test','+959791110001',
    'San Pya Rd',16.8470,96.1700,'x','cod',1000,1500,owner_id
  from public.shops where id='aaaaaaaa-0000-0000-0000-000000000001' returning id into oid;

  begin
    perform public.assign_order(oid,'44444444-4444-4444-4444-444444444444');
    raise exception 'FAIL: an offline rider was assigned work';
  exception when sqlstate '55000' then
    raise notice 'PASS: assign_order refuses an offline rider';
  end;
end $$;
reset role;
select set_config('request.jwt.claims','',false);
update public.rider_profiles set is_online=true, last_ping_at=now()
 where id='44444444-4444-4444-4444-444444444444';

\echo '=== E6. max_active_orders flips availability to busy ==='
reset role;
select set_config('request.jwt.claims','',false);
update public.rider_profiles set max_active_orders=1, availability='available', active_order_count=0,
  last_ping_at=now() where id='66666666-6666-6666-6666-666666666666';
update public.rider_profiles set coverage_km=10 where id='66666666-6666-6666-6666-666666666666';
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',false);
set role authenticated;
do $$
declare oid uuid; av public.rider_availability; n int;
begin
  select id into oid from public.orders where status='pending' order by created_at desc limit 1;
  perform public.assign_order(oid,'66666666-6666-6666-6666-666666666666');
  select availability into av from public.rider_profiles where id='66666666-6666-6666-6666-666666666666';
  if av <> 'busy' then raise exception 'FAIL: availability is % not busy', av; end if;
  -- The consequence that matters is not "hidden from a list" but "cannot be
  -- given more work", and that guard is inside assign_order itself.
  begin
    perform public.assign_order(
      (select id from public.orders where status='pending' limit 1),
      '66666666-6666-6666-6666-666666666666');
    raise exception 'FAIL: a busy rider took a second parcel';
  exception when sqlstate '55000' then
    raise notice 'PASS: capacity reached -> busy -> assign_order refuses more work';
  end;
  n := 0;
end $$;
reset role;
\echo '####  ALL EDGE CHECKS PASSED  ####'
