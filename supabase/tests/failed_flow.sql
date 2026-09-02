-- ============================================================================
--  FAILED PARCEL RESOLUTION  —  migration 0011
--
--  What happens after a delivery fails: the automatic retry, its ceiling, and
--  the shop's three ways out (retry / return / cancel).
--
--  The behaviour worth protecting here is the one 0010 introduced by accident:
--  retry used to be silent and unbounded. These assertions pin both that the
--  default still works AND that it now stops.
--
--  Run on a clean seeded DB.
-- ============================================================================
\set ON_ERROR_STOP on

select set_config('request.jwt.claims','',false);   -- service context

\set SHOP   '33333333-3333-3333-3333-333333333333'
\set RIDER1 '44444444-4444-4444-4444-444444444444'
\set RIDER2 '55555555-5555-5555-5555-555555555555'


-- ============================================================================
--  F0. STRUCTURE
-- ============================================================================

\echo '=== F0. the resolution column, its guard, and the attempt ceiling ==='
do $$
declare v_max int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'orders' and column_name = 'resolution') then
    raise exception 'FAIL: orders.resolution missing';
  end if;

  select max_delivery_attempts into v_max from public.app_settings;
  if v_max is null then raise exception 'FAIL: max_delivery_attempts missing'; end if;
  if v_max <> 3 then raise exception 'FAIL: default attempts %, expected 3', v_max; end if;

  -- An unstamped resolution is unauditable, so the constraint forbids it.
  begin
    update public.orders set resolution = 'retry', resolved_at = null
     where id = (select id from public.orders limit 1);
    raise exception 'FAIL: a resolution with no timestamp was accepted';
  exception when check_violation then
    raise notice 'PASS: resolution requires resolved_at';
  end;

  -- And only the three real answers.
  begin
    update public.orders set resolution = 'refund', resolved_at = now()
     where id = (select id from public.orders limit 1);
    raise exception 'FAIL: an unknown resolution was accepted';
  exception when check_violation then
    raise notice 'PASS: resolution is limited to retry / return / cancel';
  end;
end $$;


-- ============================================================================
--  F1. attempts are counted from the checkpoint trail, not a column
-- ============================================================================

\echo '=== F1. order_attempt_count tracks the failures ==='
do $$
declare oid uuid; o public.orders; n int;
begin
  select id into oid from public.orders where status = 'pending' order by created_at limit 1;

  if public.order_attempt_count(oid) <> 0 then
    raise exception 'FAIL: a fresh parcel already has attempts';
  end if;

  o := public.assign_order(oid, '44444444-4444-4444-4444-444444444444');
  o := public.advance_order(oid, 'picked_up');
  o := public.advance_order(oid, 'failed', null, null, null, null, 'Nobody home');

  n := public.order_attempt_count(oid);
  if n <> 1 then raise exception 'FAIL: attempt count %, expected 1', n; end if;
  if o.fail_reason is null then raise exception 'FAIL: fail_reason not recorded'; end if;
  raise notice 'PASS: one failure -> one attempt, reason kept';
end $$;


-- ============================================================================
--  F2. the shop's three ways out
-- ============================================================================

\echo '=== F2a. a shop may resolve its own failed parcel; a stranger may not ==='
do $$
declare oid uuid;
begin
  select id into oid from public.orders where status = 'failed' limit 1;

  -- rider2 has nothing to do with this parcel
  perform set_config('request.jwt.claims',
    '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', false);
  begin
    perform public.resolve_failed_order(oid, 'cancel');
    raise exception 'FAIL: an unrelated rider resolved a shop parcel';
  exception when insufficient_privilege then
    raise notice 'PASS: resolve_failed_order refused an unrelated user';
  end;
  perform set_config('request.jwt.claims','',false);
end $$;

\echo '=== F2b. RETRY puts it back in the pool and clears the stale reason ==='
do $$
declare oid uuid; o public.orders;
begin
  select id into oid from public.orders where status = 'failed' limit 1;

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
  o := public.resolve_failed_order(oid, 'retry', 'Customer says try tomorrow morning');
  perform set_config('request.jwt.claims','',false);

  if o.status <> 'pending' then raise exception 'FAIL: status %, expected pending', o.status; end if;
  if o.resolution <> 'retry' then raise exception 'FAIL: resolution %', o.resolution; end if;
  if o.resolved_at is null then raise exception 'FAIL: resolved_at not stamped'; end if;
  -- The next attempt starts clean, exactly as assign_order does it.
  if o.fail_reason is not null then
    raise exception 'FAIL: stale fail_reason kept: %', o.fail_reason;
  end if;
  -- The attempt history is NOT erased -- that is the point of deriving it.
  if public.order_attempt_count(oid) <> 1 then
    raise exception 'FAIL: retry erased the attempt history';
  end if;
  raise notice 'PASS: retry -> pending, reason cleared, history kept';
end $$;

\echo '=== F2c. RETURN stops delivery without touching the status machine ==='
--  `pending -> failed` is forbidden by the status machine, and rightly so. The
--  resolution is a separate axis, which is what lets a shop say "bring it back"
--  about a parcel close_trip already auto-retried to `pending`.
do $$
declare oid uuid; o public.orders; before public.order_status;
begin
  select id into oid from public.orders where resolution = 'retry' limit 1;
  select status into before from public.orders where id = oid;

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
  o := public.resolve_failed_order(oid, 'return', 'Customer refused it, send it back');
  perform set_config('request.jwt.claims','',false);

  if o.resolution <> 'return' then raise exception 'FAIL: resolution %', o.resolution; end if;
  if o.status <> before then
    raise exception 'FAIL: return changed status from % to %', before, o.status;
  end if;
  if o.resolution_note is null then raise exception 'FAIL: note not kept'; end if;
  raise notice 'PASS: return recorded, status untouched (%), note kept', o.status;
end $$;

\echo '=== F2d. CANCEL is terminal and carries the reason ==='
do $$
declare oid uuid; o public.orders;
begin
  select id into oid from public.orders where resolution = 'return' limit 1;

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
  o := public.resolve_failed_order(oid, 'cancel', 'Customer bought elsewhere');
  perform set_config('request.jwt.claims','',false);

  if o.status <> 'cancelled' then raise exception 'FAIL: status %', o.status; end if;
  if o.cancel_reason is null then raise exception 'FAIL: cancel_reason empty'; end if;
  if o.closed_at is null then raise exception 'FAIL: closed_at not stamped'; end if;

  -- ...and a closed parcel cannot be resolved again.
  begin
    perform public.resolve_failed_order(oid, 'retry');
    raise exception 'FAIL: a cancelled parcel was resolved again';
  exception when sqlstate '55000' then
    raise notice 'PASS: cancel is terminal — no further resolution';
  end;
end $$;

\echo '=== F2e. a parcel that never failed has nothing to resolve ==='
do $$
declare oid uuid;
begin
  select id into oid from public.orders where status = 'pending'
     and public.order_attempt_count(id) = 0 limit 1;
  if oid is null then raise notice 'SKIP: no untouched parcel left'; return; end if;

  perform public.resolve_failed_order(oid, 'return');
  raise exception 'FAIL: resolved a parcel that never failed';
exception when sqlstate '55000' then
  raise notice 'PASS: order_never_failed refused';
end $$;

\echo '=== F2f. a parcel a rider is carrying is not the shop''s to redirect ==='
do $$
declare oid uuid; o public.orders;
begin
  select id into oid from public.orders where status = 'pending'
     and public.order_attempt_count(id) > 0 limit 1;
  if oid is null then
    -- make one: fail it, retry it, then hand it to a rider again
    select id into oid from public.orders where status = 'pending' limit 1;
    o := public.assign_order(oid, '44444444-4444-4444-4444-444444444444');
    o := public.advance_order(oid, 'failed', null, null, null, null, 'first try');
    o := public.resolve_failed_order(oid, 'retry');
  end if;
  o := public.assign_order(oid, '44444444-4444-4444-4444-444444444444');

  begin
    perform public.resolve_failed_order(oid, 'return');
    raise exception 'FAIL: redirected a parcel that is out with a rider';
  exception when sqlstate '55000' then
    raise notice 'PASS: order_in_flight refused while the rider holds it';
  end;

  -- put it back so later sections start from a known place
  update public.orders set status = 'pending' where id = oid;
end $$;


-- ============================================================================
--  F3. close_trip: auto-retry under the cap, hold at it
-- ============================================================================

\echo '=== F3. the automatic retry stops at max_delivery_attempts ==='
do $$
declare
  v_route uuid; t public.trips; oid uuid; o public.orders;
  i int; n_attempts int; v_status public.order_status; v_trip uuid;
begin
  select id into v_route from public.routes where code = 'ROUTE_A';

  -- One fresh parcel, failed on a run over and over.
  insert into public.orders (
    shop_id, pickup_address, pickup_lat, pickup_lng, customer_name, customer_phone,
    dropoff_address, dropoff_area_id, dropoff_lat, dropoff_lng, parcel_desc,
    payment_method, cod_amount, delivery_fee, created_by)
  select 'aaaaaaaa-0000-0000-0000-000000000001',
    'No. 24, Thitsar Road', 16.8478, 96.1693, 'Cap Test', '+959790004444',
    'Sule Pagoda Road, Kyauktada', a.id, 16.7760, 96.1580, 'cap test parcel',
    'prepaid', 0, r.per_parcel_fee, '33333333-3333-3333-3333-333333333333'
  from public.service_areas a
  join public.route_areas ra on ra.area_id = a.id and ra.is_primary
  join public.routes r on r.id = ra.route_id
  where a.name = 'Kyauktada / Sule'
  returning id into oid;

  for i in 1..3 loop
    t := public.plan_trip(v_route);
    t := public.assign_trip_rider(t.id, '44444444-4444-4444-4444-444444444444');
    t := public.load_trip(t.id, array[oid], 'delivery');
    t := public.depart_trip(t.id, 'Cap test run, deliberately short volume.');
    o := public.advance_order(oid, 'picked_up');
    o := public.advance_order(oid, 'failed', null, null, null, null, 'attempt ' || i);
    t := public.close_trip(t.id);

    select status, trip_id into v_status, v_trip from public.orders where id = oid;
    n_attempts := public.order_attempt_count(oid);

    if v_trip is not null then
      raise exception 'FAIL: attempt % left the parcel attached to a trip', i;
    end if;

    if i < 3 then
      -- Under the cap: 0010's behaviour, kept.
      if v_status <> 'pending' then
        raise exception 'FAIL: attempt % of 3 -> status %, expected pending', i, v_status;
      end if;
    else
      -- At the cap: 0011's new behaviour. It stops and waits.
      if v_status <> 'failed' then
        raise exception 'FAIL: at the cap -> status %, expected failed', v_status;
      end if;
      if (select resolution from public.orders where id = oid) is not null then
        raise exception 'FAIL: the parcel resolved itself';
      end if;
    end if;
    raise notice '  attempt %/3: status=% attempts=%', i, v_status, n_attempts;
  end loop;

  raise notice 'PASS: auto-retried twice, then held at the cap for the shop';
end $$;

\echo '=== F3b. the rider is paid for a failed attempt either way ==='
--  The whole reason the release happens AFTER the pay snapshot: the rider rode
--  to the address, and paying only on success would make a refusal their loss.
do $$
declare v_pay bigint; n int;
begin
  select count(*), coalesce(sum(-amount), 0) into n, v_pay
    from public.cod_ledger where kind = 'trip_pay';
  if n < 3 then raise exception 'FAIL: only % trip_pay lines for 3 runs', n; end if;
  if v_pay <= 0 then raise exception 'FAIL: rider earned % across the runs', v_pay; end if;
  raise notice 'PASS: % trip_pay lines totalling % Ks for the failed attempts', n, v_pay;
end $$;

\echo '=== F3c. a shop decision made mid-run survives the close ==='
do $$
declare v_route uuid; t public.trips; oid uuid; o public.orders; v_status public.order_status;
begin
  select id into v_route from public.routes where code = 'ROUTE_A';

  -- Creates its own parcel rather than hunting for a spare one. It used to look
  -- for `pending and trip_id is null and resolution is null`, and by this point
  -- the earlier sections have consumed every such row -- so the section silently
  -- SKIPPED and the most important assertion in this file never ran.
  insert into public.orders (
    shop_id, pickup_address, pickup_lat, pickup_lng, customer_name, customer_phone,
    dropoff_address, dropoff_area_id, dropoff_lat, dropoff_lng, parcel_desc,
    payment_method, cod_amount, delivery_fee, created_by)
  select 'aaaaaaaa-0000-0000-0000-000000000001',
    'No. 24, Thitsar Road', 16.8478, 96.1693, 'Mid Run Decision', '+959790005555',
    'Sule Pagoda Road, Kyauktada', a.id, 16.7760, 96.1580, 'mid-run decision parcel',
    'prepaid', 0, r.per_parcel_fee, '33333333-3333-3333-3333-333333333333'
  from public.service_areas a
  join public.route_areas ra on ra.area_id = a.id and ra.is_primary
  join public.routes r on r.id = ra.route_id
  where a.name = 'Kyauktada / Sule'
  returning id into oid;

  t := public.plan_trip(v_route);
  t := public.assign_trip_rider(t.id, '55555555-5555-5555-5555-555555555555');
  t := public.load_trip(t.id, array[oid], 'delivery');
  t := public.depart_trip(t.id, 'Mid-run decision test, deliberately short.');
  o := public.advance_order(oid, 'picked_up');
  o := public.advance_order(oid, 'failed', null, null, null, null, 'refused at the door');

  -- The shop decides while the run is still out.
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
  o := public.resolve_failed_order(oid, 'return', 'Do not try again, bring it back');
  perform set_config('request.jwt.claims','',false);

  t := public.close_trip(t.id);

  select status into v_status from public.orders where id = oid;
  if v_status = 'pending' then
    raise exception 'FAIL: close_trip re-dispatched a parcel the shop asked back';
  end if;
  if (select resolution from public.orders where id = oid) <> 'return' then
    raise exception 'FAIL: the decision did not survive the close';
  end if;
  if (select trip_id from public.orders where id = oid) is not null then
    raise exception 'FAIL: the parcel is still attached to the closed trip';
  end if;
  raise notice 'PASS: a 3pm decision held through the 6pm close (status %)', v_status;
end $$;

\echo '=== F3d. the close audit row says what happened to the failures ==='
do $$
declare v_after jsonb;
begin
  select after into v_after from public.audit_log
   where action = 'trip.close' order by created_at desc limit 1;
  if v_after is null then raise exception 'FAIL: no trip.close audit row'; end if;
  if not (v_after ? 'released_for_retry') then
    raise exception 'FAIL: audit row does not record released_for_retry';
  end if;
  if not (v_after ? 'held_for_shop') then
    raise exception 'FAIL: audit row does not record held_for_shop';
  end if;
  raise notice 'PASS: close records released=% held=%',
    v_after ->> 'released_for_retry', v_after ->> 'held_for_shop';
end $$;

\echo ''
\echo '####  ALL FAILED-PARCEL CHECKS PASSED  ####'
