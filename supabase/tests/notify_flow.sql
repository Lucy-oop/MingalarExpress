-- ============================================================================
--  NOTIFICATION OUTBOX  —  migration 0014
--
--  Telling the shop a parcel failed. Everything here is about the three ways
--  this can go quietly wrong and cost either money or trust:
--
--    a message sent twice      the platform pays per segment, and a shop that
--                              gets the same text twice stops reading them
--    a message sent at 2am     a shop desk phone waking a family up
--    a message never sent      the worst one, and the only one with no evidence
--                              unless the row lands in `dead` where it is visible
--
--  Run on a clean seeded DB.
-- ============================================================================
\set ON_ERROR_STOP on

select set_config('request.jwt.claims','',false);   -- service context

\set SHOP   '33333333-3333-3333-3333-333333333333'
\set RIDER1 '44444444-4444-4444-4444-444444444444'
\set RIDER2 '55555555-5555-5555-5555-555555555555'

-- Same session-local factory as failed_flow: every section makes its own
-- parcels rather than competing for the seeded ones.
create or replace function pg_temp.mk_parcel(
  p_customer   text,
  p_resolution text default null,
  p_cod        bigint default 0
) returns uuid language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.orders (
    shop_id, pickup_address, pickup_lat, pickup_lng, customer_name, customer_phone,
    dropoff_address, dropoff_area_id, dropoff_lat, dropoff_lng, parcel_desc,
    payment_method, cod_amount, delivery_fee, created_by, resolution, resolved_at)
  select 'aaaaaaaa-0000-0000-0000-000000000001',
    'No. 24, Thitsar Road', 16.8478, 96.1693, p_customer, '+959790007777',
    'Sule Pagoda Road, Kyauktada', a.id, 16.7760, 96.1580, p_customer || ' parcel',
    case when p_cod > 0 then 'cod' else 'prepaid' end::public.payment_method,
    p_cod, r.per_parcel_fee, '33333333-3333-3333-3333-333333333333',
    p_resolution, case when p_resolution is null then null else now() end
  from public.service_areas a
  join public.route_areas ra on ra.area_id = a.id and ra.is_primary
  join public.routes r on r.id = ra.route_id
  where a.name = 'Kyauktada / Sule'
  returning id into v_id;
  return v_id;
end $fn$;

-- Fail a parcel once, the way a rider does. Returns the order id.
create or replace function pg_temp.fail_once(p_order uuid, p_reason text default 'Nobody home')
returns void language plpgsql as $fn$
begin
  perform public.assign_order(p_order, '44444444-4444-4444-4444-444444444444');
  perform public.advance_order(p_order, 'picked_up');
  perform public.advance_order(p_order, 'failed', null, null, null, null, p_reason);
end $fn$;


-- ============================================================================
--  N0. STRUCTURE
-- ============================================================================

\echo '=== N0. the outbox, its states and its settings ==='
do $$
declare v_from smallint; v_until smallint; v_max smallint; v_on boolean;
begin
  if to_regclass('public.notification_outbox') is null then
    raise exception 'FAIL: notification_outbox missing';
  end if;

  select notify_quiet_from, notify_quiet_until, notify_max_attempts, notifications_enabled
    into v_from, v_until, v_max, v_on
    from public.app_settings where id;

  if (v_from, v_until, v_max, v_on) is distinct from (21::smallint, 7::smallint, 5::smallint, true) then
    raise exception 'FAIL: defaults are % % % %', v_from, v_until, v_max, v_on;
  end if;

  -- There is deliberately no `failed` state: a retryable error returns the row
  -- to `queued`. A fifth state would give the worker a second thing to check.
  begin
    insert into public.notification_outbox (event, dedupe_key, status, to_phone)
    values ('parcel_failed', 'n0:bad-state', 'failed', '+959790001111');
    raise exception 'FAIL: an unknown outbox state was accepted';
  exception when check_violation then
    raise notice 'PASS: outbox states are queued / sending / sent / dead';
  end;

  begin
    insert into public.notification_outbox (event, dedupe_key, to_phone)
    values ('marketing_blast', 'n0:bad-event', '+959790001111');
    raise exception 'FAIL: an unknown event was accepted';
  exception when check_violation then
    raise notice 'PASS: only parcel_failed and parcel_held exist';
  end;

  begin
    insert into public.notification_outbox (event, dedupe_key, to_phone)
    values ('parcel_failed', 'n0:dupe', '+959790001111');
    insert into public.notification_outbox (event, dedupe_key, to_phone)
    values ('parcel_held',   'n0:dupe', '+959790001111');
    raise exception 'FAIL: dedupe_key is not unique';
  exception when unique_violation then
    raise notice 'PASS: dedupe_key is unique';
  end;

  delete from public.notification_outbox where dedupe_key like 'n0:%';
end $$;


-- ============================================================================
--  N1. QUIET HOURS
--
--  Computed at enqueue, so this is the single place the clock logic lives.
-- ============================================================================

\echo '=== N1. the 9pm-7am window, including the midnight wrap ==='
do $$
declare
  v_cases constant text[] := array['10:00','20:59','21:00','23:30'];
  v_expect constant text[] := array['10:00','20:59','07:00','07:00'];
  v_at timestamptz; v_out text; i int;
begin
  for i in 1 .. array_length(v_cases, 1) loop
    v_at := ('2026-09-03 ' || v_cases[i])::timestamp at time zone 'Asia/Yangon';
    v_out := to_char(public.notify_send_after(v_at) at time zone 'Asia/Yangon', 'HH24:MI');
    if v_out <> v_expect[i] then
      raise exception 'FAIL: % -> %, expected %', v_cases[i], v_out, v_expect[i];
    end if;
  end loop;

  -- Raised before dawn: today at 07:00, NOT tomorrow. Getting this backwards
  -- delays every overnight message by a full day.
  v_at := '2026-09-04 03:15'::timestamp at time zone 'Asia/Yangon';
  if to_char(public.notify_send_after(v_at) at time zone 'Asia/Yangon', 'YYYY-MM-DD HH24:MI')
     <> '2026-09-04 07:00' then
    raise exception 'FAIL: a 03:15 message did not go out the same morning';
  end if;

  -- And 23:30 is TOMORROW morning, not the same date's 07:00 in the past.
  v_at := '2026-09-03 23:30'::timestamp at time zone 'Asia/Yangon';
  if public.notify_send_after(v_at) <= v_at then
    raise exception 'FAIL: a late-night message was scheduled in the past';
  end if;

  raise notice 'PASS: quiet hours hold across the midnight wrap';
end $$;

\echo '=== N1b. an empty window sends immediately (how staging runs) ==='
do $$
declare v_at timestamptz := '2026-09-03 23:30'::timestamp at time zone 'Asia/Yangon';
begin
  update public.app_settings set notify_quiet_from = 0, notify_quiet_until = 0 where id;
  if public.notify_send_after(v_at) <> v_at then
    raise exception 'FAIL: a disabled window still delayed the message';
  end if;
  update public.app_settings set notify_quiet_from = 21, notify_quiet_until = 7 where id;
  raise notice 'PASS: from = until disables the window';
end $$;


-- ============================================================================
--  N2. A FAILURE RAISES EXACTLY ONE MESSAGE
-- ============================================================================

\echo '=== N2. the first failure enqueues one parcel_failed for the shop ==='
do $$
declare oid uuid; r public.notification_outbox; n int;
begin
  oid := pg_temp.mk_parcel('Notify One');
  perform pg_temp.fail_once(oid, 'Gate locked');

  select count(*) into n from public.notification_outbox where order_id = oid;
  if n <> 1 then raise exception 'FAIL: % rows for one failure, expected 1', n; end if;

  select * into r from public.notification_outbox where order_id = oid;
  if r.event <> 'parcel_failed' then raise exception 'FAIL: event %', r.event; end if;
  if r.status <> 'queued' then raise exception 'FAIL: status %', r.status; end if;
  if r.channel <> 'sms' then raise exception 'FAIL: channel %', r.channel; end if;
  if r.shop_id <> 'aaaaaaaa-0000-0000-0000-000000000001' then
    raise exception 'FAIL: shop %', r.shop_id;
  end if;

  -- The shop desk phone, not the customer's and not the rider's.
  if r.to_phone is distinct from (select phone from public.shops
                                   where id = 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'FAIL: recipient % is not the shop phone', r.to_phone;
  end if;
  if r.lang is distinct from (select p.preferred_lang from public.profiles p
                               join public.shops s on s.owner_id = p.id
                              where s.id = 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'FAIL: lang % is not the owner preference', r.lang;
  end if;

  -- The payload is what the renderer reads. An attempt number one too low here
  -- means orders_notify is firing before orders_audit writes the checkpoint.
  if (r.payload ->> 'attempt')::int <> 1 then
    raise exception 'FAIL: payload attempt %, expected 1', r.payload ->> 'attempt';
  end if;
  if (r.payload ->> 'max_attempts')::int <> 3 then
    raise exception 'FAIL: payload max_attempts %', r.payload ->> 'max_attempts';
  end if;
  if r.payload ->> 'code' is null then raise exception 'FAIL: payload has no code'; end if;

  raise notice 'PASS: one failure -> one queued parcel_failed, attempt 1 of 3';
end $$;

\echo '=== N2b. the dedupe key is per attempt, so a re-entry costs nothing ==='
do $$
declare oid uuid; n int; k text;
begin
  select order_id into oid from public.notification_outbox
   where event = 'parcel_failed' order by id desc limit 1;
  select dedupe_key into k from public.notification_outbox where order_id = oid;

  -- Exactly what close_trip's release does, and what a second close would do.
  update public.orders set trip_id = null, trip_leg = null where id = oid;
  perform public.enqueue_notification('parcel_failed', oid, k, '{}'::jsonb);

  select count(*) into n from public.notification_outbox where order_id = oid;
  if n <> 1 then raise exception 'FAIL: % rows after a re-entry, expected 1', n; end if;
  raise notice 'PASS: re-enqueuing the same event is a no-op';
end $$;


-- ============================================================================
--  N3. THE ATTEMPT CEILING PICKS THE OTHER EVENT
--
--  The two events are mutually exclusive and chosen at failure time. An earlier
--  design sent parcel_failed AND then parcel_held minutes later — two SMS to say
--  one thing, on the platform's bill.
-- ============================================================================

\echo '=== N3. the third failure is parcel_held, not a fourth parcel_failed ==='
do $$
declare oid uuid; v_events text[]; v_attempts int[];
begin
  oid := pg_temp.mk_parcel('Notify Cap');

  perform pg_temp.fail_once(oid, 'Attempt one');
  update public.orders set status = 'pending' where id = oid;   -- as close_trip does
  perform pg_temp.fail_once(oid, 'Attempt two');
  update public.orders set status = 'pending' where id = oid;
  perform pg_temp.fail_once(oid, 'Attempt three');

  select array_agg(event order by id), array_agg((payload ->> 'attempt')::int order by id)
    into v_events, v_attempts
    from public.notification_outbox where order_id = oid;

  if v_events <> array['parcel_failed','parcel_failed','parcel_held'] then
    raise exception 'FAIL: events %, expected failed/failed/held', v_events;
  end if;
  if v_attempts <> array[1,2,3] then
    raise exception 'FAIL: attempts %, expected 1/2/3', v_attempts;
  end if;
  raise notice 'PASS: three attempts -> three messages, the last one a hold';
end $$;

\echo '=== N3b. a parcel the shop has already decided on says nothing ==='
do $$
declare oid uuid; n int;
begin
  -- resolution = 'return' is the failed RETURN leg from 0013. The shop asked for
  -- this; there is no decision left to chase them for.
  oid := pg_temp.mk_parcel('Notify Resolved', 'return');
  perform pg_temp.fail_once(oid, 'Shop was shut');

  select count(*) into n from public.notification_outbox where order_id = oid;
  if n <> 0 then raise exception 'FAIL: % messages for a resolved parcel', n; end if;
  raise notice 'PASS: a resolved parcel raises nothing';
end $$;


-- ============================================================================
--  N4. THE KILL SWITCH AND THE UNREACHABLE SHOP
-- ============================================================================

\echo '=== N4. notifications_enabled = false enqueues nothing at all ==='
do $$
declare oid uuid; n int;
begin
  update public.app_settings set notifications_enabled = false where id;
  oid := pg_temp.mk_parcel('Notify Off');
  perform pg_temp.fail_once(oid, 'Nobody home');
  select count(*) into n from public.notification_outbox where order_id = oid;
  update public.app_settings set notifications_enabled = true where id;

  if n <> 0 then raise exception 'FAIL: % messages while switched off', n; end if;
  raise notice 'PASS: the master switch stops the outbox filling';
end $$;

\echo '=== N4b. a shop with no phone dead-letters visibly, it is not skipped ==='
--  shops.phone and the owner's profile phone are both populated in every real
--  row today, so this branch is unreachable through the front door. It is worth
--  a test anyway: a message nobody can send must land somewhere a human can see
--  it, and "we silently wrote nothing" is the one outcome with no evidence.
--  The NOT NULL is dropped and restored inside the block to reach it.
do $$
declare oid uuid; r public.notification_outbox;
begin
  oid := pg_temp.mk_parcel('Notify Unreachable');

  alter table public.shops alter column phone drop not null;
  update public.shops set phone = null
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  update public.profiles set phone = null
   where id = '33333333-3333-3333-3333-333333333333';

  perform public.enqueue_notification('parcel_failed', oid, 'n4:unreachable',
    jsonb_build_object('code','MGE-TEST','attempt',1,'max_attempts',3));

  select * into r from public.notification_outbox where dedupe_key = 'n4:unreachable';
  if r.id is null then
    raise exception 'FAIL: an unreachable shop produced no row at all';
  end if;
  if r.to_phone is not null then
    raise exception 'FAIL: phone % resolved from nowhere', r.to_phone;
  end if;
  if r.status <> 'dead' then
    raise exception 'FAIL: an unreachable shop was queued rather than dead-lettered (%)', r.status;
  end if;
  if r.last_error is distinct from 'no_recipient_phone' then
    raise exception 'FAIL: no reason recorded, just a dead row: %', r.last_error;
  end if;
  -- And it is not sitting in the worker's queue burning attempts.
  if exists (select 1 from public.claim_notifications(20) c where c.id = r.id) then
    raise exception 'FAIL: a dead-lettered message was claimed for sending';
  end if;

  update public.shops set phone = '+959770001111'
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  update public.profiles set phone = '+959770001111'
   where id = '33333333-3333-3333-3333-333333333333';
  alter table public.shops alter column phone set not null;

  raise notice 'PASS: a shop we cannot reach dead-letters with a reason, not silence';
end $$;


-- ============================================================================
--  N5. THE WORKER'S THREE VERBS
-- ============================================================================

\echo '=== N5. claim is exclusive, counts the attempt, and skips what is not due ==='
do $$
declare v_id bigint; v_future bigint; n int; r public.notification_outbox;
begin
  delete from public.notification_outbox;

  insert into public.notification_outbox (event, dedupe_key, to_phone, send_after)
  values ('parcel_failed', 'n5:due', '+959790001111', now() - interval '1 minute')
  returning id into v_id;

  -- Queued for the morning. A worker running at 23:00 must not touch it.
  insert into public.notification_outbox (event, dedupe_key, to_phone, send_after)
  values ('parcel_failed', 'n5:quiet', '+959790002222', now() + interval '6 hours')
  returning id into v_future;

  select count(*) into n from public.claim_notifications(20);
  if n <> 1 then raise exception 'FAIL: claimed % rows, expected 1', n; end if;

  select * into r from public.notification_outbox where id = v_id;
  if r.status <> 'sending' then raise exception 'FAIL: status %', r.status; end if;
  if r.attempts <> 1 then raise exception 'FAIL: attempts %, expected 1', r.attempts; end if;
  if r.claimed_at is null then raise exception 'FAIL: claimed_at not stamped'; end if;

  if (select status from public.notification_outbox where id = v_future) <> 'queued' then
    raise exception 'FAIL: a message queued for the morning was claimed tonight';
  end if;

  -- A second pass finds nothing: the first claim is what holds it.
  if (select count(*) from public.claim_notifications(20)) <> 0 then
    raise exception 'FAIL: a claimed row was claimed twice';
  end if;

  perform public.complete_notification(v_id, 'log', 'log-abc');
  select * into r from public.notification_outbox where id = v_id;
  if r.status <> 'sent' then raise exception 'FAIL: status % after complete', r.status; end if;
  if r.sent_at is null or r.provider <> 'log' or r.provider_message_id <> 'log-abc' then
    raise exception 'FAIL: the send was not recorded';
  end if;
  raise notice 'PASS: claim -> sending -> sent, and nothing due is taken early';
end $$;

\echo '=== N5b. a retryable error backs off; a permanent one dies at once ==='
do $$
declare v_id bigint; r public.notification_outbox; v_before timestamptz;
begin
  delete from public.notification_outbox;

  insert into public.notification_outbox (event, dedupe_key, to_phone)
  values ('parcel_failed', 'n5:retry', '+959790001111') returning id into v_id;
  perform public.claim_notifications(20);

  v_before := now();
  r := public.fail_notification(v_id, 'HTTP 503: gateway down', true);
  if r.status <> 'queued' then raise exception 'FAIL: retryable error left it %', r.status; end if;
  if r.send_after <= v_before then raise exception 'FAIL: no backoff applied'; end if;
  if r.last_error is null then raise exception 'FAIL: the error was not recorded'; end if;
  if r.claimed_at is not null then raise exception 'FAIL: the claim was not released'; end if;

  -- THE ONE THAT MATTERS. An invalid number retried five times is four wasted
  -- sends and hours before anyone finds out the shop was never told.
  r := public.fail_notification(v_id, 'HTTP 400: invalid msisdn', false);
  if r.status <> 'dead' then
    raise exception 'FAIL: a permanent error was queued for retry (%)', r.status;
  end if;
  raise notice 'PASS: retryable backs off, permanent dead-letters immediately';
end $$;

\echo '=== N5c. the retry ceiling actually binds ==='
do $$
declare v_id bigint; r public.notification_outbox; v_max smallint;
begin
  delete from public.notification_outbox;
  select notify_max_attempts into v_max from public.app_settings where id;

  insert into public.notification_outbox (event, dedupe_key, to_phone, attempts)
  values ('parcel_failed', 'n5:ceiling', '+959790001111', v_max) returning id into v_id;

  r := public.fail_notification(v_id, 'HTTP 503: still down', true);
  if r.status <> 'dead' then
    raise exception 'FAIL: attempt % of % was retried again', v_max, v_max;
  end if;
  raise notice 'PASS: a message stops after % attempts', v_max;
end $$;

\echo '=== N5d. a worker that died mid-send does not lose the message ==='
do $$
declare v_id bigint; n int;
begin
  delete from public.notification_outbox;

  -- Claimed, then the process was killed. Without the reclaim this row sits in
  -- `sending` forever and the shop is never told.
  insert into public.notification_outbox (event, dedupe_key, to_phone, status, claimed_at)
  values ('parcel_failed', 'n5:stuck', '+959790001111', 'sending', now() - interval '20 minutes')
  returning id into v_id;

  select count(*) into n from public.claim_notifications(20);
  if n <> 1 then raise exception 'FAIL: a stuck claim was not reclaimed'; end if;

  -- But a claim from ten seconds ago belongs to a worker that is still running.
  update public.notification_outbox set status = 'sending', claimed_at = now() where id = v_id;
  if (select count(*) from public.claim_notifications(20)) <> 0 then
    raise exception 'FAIL: a live worker''s claim was stolen';
  end if;
  raise notice 'PASS: claims older than five minutes are reclaimed, fresh ones are not';
end $$;


-- ============================================================================
--  N6. WHO MAY SEE AND DO WHAT
-- ============================================================================

\echo '=== N6. the outbox is dispatch-readable and nobody else''s business ==='
do $$
declare n int;
begin
  delete from public.notification_outbox;
  insert into public.notification_outbox (event, dedupe_key, to_phone, shop_id)
  values ('parcel_failed', 'n6:one', '+959790001111', 'aaaaaaaa-0000-0000-0000-000000000001');

  set local role authenticated;

  -- The shop owns the parcel and still cannot read the outbox: there is no
  -- screen for it yet, and a policy written before its screen is a policy
  -- nobody re-reads.
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  select count(*) into n from public.notification_outbox;
  if n <> 0 then raise exception 'FAIL: a shop read % outbox rows', n; end if;

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  select count(*) into n from public.notification_outbox;
  if n <> 1 then raise exception 'FAIL: a dispatcher read % rows, expected 1', n; end if;

  reset role;
  perform set_config('request.jwt.claims','',false);
  raise notice 'PASS: dispatch reads the outbox, a shop does not';
end $$;

\echo '=== N6b. a logged-in user cannot drain the outbox ==='
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  begin
    perform public.claim_notifications(20);
    raise exception 'FAIL: a shop owner claimed the outbox';
  exception when insufficient_privilege then
    raise notice 'PASS: claim_notifications is service-role only';
  end;
  reset role;
  perform set_config('request.jwt.claims','',false);
end $$;

\echo '=== N6c. and cannot mark somebody else''s message sent ==='
do $$
declare v_id bigint;
begin
  delete from public.notification_outbox;
  insert into public.notification_outbox (event, dedupe_key, to_phone)
  values ('parcel_failed', 'n6:sent', '+959790001111') returning id into v_id;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  begin
    perform public.complete_notification(v_id, 'log', 'forged');
    raise exception 'FAIL: a shop owner marked a message sent';
  exception when insufficient_privilege then
    raise notice 'PASS: complete_notification is service-role only';
  end;

  -- Nor by writing the table directly: there is no INSERT/UPDATE policy at all.
  begin
    update public.notification_outbox set status = 'sent' where id = v_id;
    if found then raise exception 'FAIL: a shop owner updated the outbox directly'; end if;
    raise notice 'PASS: no write policy exists, so a direct update changes nothing';
  exception when insufficient_privilege then
    raise notice 'PASS: a direct update on the outbox is refused';
  end;

  reset role;
  perform set_config('request.jwt.claims','',false);
end $$;


\echo ''
\echo '####  ALL NOTIFICATION CHECKS PASSED  ####'
