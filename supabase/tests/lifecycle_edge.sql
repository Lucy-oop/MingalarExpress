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

\echo '=== E7. a shop may register with no map pin, but not with half of one ==='
--  0034. Registration used to fail closed: pickup_lat/lng were NOT NULL behind
--  the geofence CHECK, so a merchant whose street Nominatim has never heard of
--  could not create a shop at all -- and on six realistic Yangon addresses the
--  lookup found two. The pin became optional so the first screen a merchant
--  sees can never turn them away.
--
--  What must NOT have been relaxed along with it: the geofence itself, and the
--  completeness of a pin that IS given. Half a point is not a location.
do $$
declare sid uuid; g text;
begin
  insert into public.shops (owner_id, name, phone, goods_type, pickup_address)
  values ('22222222-2222-2222-2222-222222222222', 'Pinless Test Mart',
          '+959770000091', 'Clothes', 'No 7, Thanlyin market road')
  returning id into sid;

  -- The generated geography must be NULL, not a point at (0, 0) in the Gulf of
  -- Guinea. st_makepoint is strict, and this asserts it stays that way.
  select coalesce(pickup_geog::text, '(null)') into g
    from public.shops where id = sid;
  if g <> '(null)' then
    raise exception 'FAIL: a pinless shop got a geography of %', g;
  end if;
  raise notice 'PASS: a shop registers on its address alone, geog null';

  begin
    update public.shops set pickup_lat = 16.8478 where id = sid;
    raise exception 'FAIL: stored a latitude with no longitude';
  exception when check_violation then
    raise notice 'PASS: half a pin is refused';
  end;

  update public.shops set pickup_lat = 16.8478, pickup_lng = 96.1693 where id = sid;
  raise notice 'PASS: the pin can be filled in later';

  -- THE GEOFENCE IS STILL THE GEOFENCE. Mandalay is 21.96 N, well outside.
  begin
    update public.shops set pickup_lat = 21.9588, pickup_lng = 96.0891 where id = sid;
    raise exception 'FAIL: a Mandalay pin was accepted';
  exception when check_violation then
    raise notice 'PASS: an out-of-area pin is still refused';
  end;

  update public.shops set pickup_lat = null, pickup_lng = null where id = sid;
  raise notice 'PASS: and a pin can be cleared back to unknown';

  delete from public.shops where id = sid;
end $$;

\echo '=== E8. the notice marker is the reader own row, and only theirs ==='
--  0035. The office header counts unseen notices against
--  profiles.notices_seen_at, written by the READER through
--  profiles_update_self -- the same path setLocale has used since the language
--  switcher shipped.
--
--  Two things worth pinning. It must NOT need super_admin, or every dispatcher
--  gets a badge they can never clear. And it must not become a way to write
--  somebody else's profile row: RLS scopes the update to id = auth.uid(), so the
--  id is never taken from the caller.
select set_config('request.jwt.claims','{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}',false);
set role authenticated;
do $$
declare seen timestamptz; n int;
begin
  -- A rider is the least privileged real session there is; if this works for
  -- them it works for a dispatcher.
  update public.profiles set notices_seen_at = now()
   where id = '55555555-5555-5555-5555-555555555555';
  select notices_seen_at into seen from public.profiles
   where id = '55555555-5555-5555-5555-555555555555';
  if seen is null then
    raise exception 'FAIL: a non-admin could not mark their own notices seen';
  end if;
  raise notice 'PASS: a reader can mark their own notices seen';

  -- Somebody else's row. RLS filters it away rather than raising, so the proof
  -- is that NOTHING changed -- `found` would be true if the row were visible.
  update public.profiles set notices_seen_at = now()
   where id = '44444444-4444-4444-4444-444444444444';
  if found then
    raise exception 'FAIL: a rider marked another person''s notices seen';
  end if;
  raise notice 'PASS: and cannot touch anyone else''s';

  -- And the guard still guards. The marker must not have opened a door to the
  -- two columns tg_profiles_guard exists for.
  begin
    update public.profiles set notices_seen_at = now(), role = 'super_admin'
     where id = '55555555-5555-5555-5555-555555555555';
    raise exception 'FAIL: a rider escalated their role alongside the marker';
  exception when insufficient_privilege then
    raise notice 'PASS: role is still guarded on the same statement';
  end;
end $$;
reset role;

\echo '=== E9. a parcel can be booked with no pickup pin, but not half of one ==='
--  0036. 0034 let a SHOP register with no map pin, and this migration lets it
--  BOOK -- otherwise the dead end simply moved one screen later and a merchant
--  the geocoder cannot place still could not sell anything.
--
--  What must NOT have gone with it: the geofence on a pin that IS given, the
--  both-or-neither rule, and the DROPOFF still being mandatory. A delivery with
--  nowhere to go is not a parcel.
do $$
declare oid uuid; g text;
begin
  insert into public.orders (shop_id, pickup_address,
    customer_name, customer_phone, dropoff_address, dropoff_lat, dropoff_lng,
    parcel_desc, payment_method, cod_amount, delivery_fee, created_by)
  select id, pickup_address, 'No Pin Customer', '+959791110091',
    'Kyaung Kone Rd, Thingangyun', 16.8500, 96.1880, 'pinless pickup', 'cod',
    5000, 4000, owner_id
  from public.shops where id = 'aaaaaaaa-0000-0000-0000-000000000001'
  returning id into oid;

  -- The generated geography must be NULL, not a point at (0,0) in the Gulf of
  -- Guinea. st_makepoint is strict; this asserts it stays that way.
  select coalesce(pickup_geog::text, '(null)') into g from public.orders where id = oid;
  if g <> '(null)' then
    raise exception 'FAIL: a pinless parcel got a pickup geography of %', g;
  end if;
  raise notice 'PASS: a parcel books on the pickup address alone, geog null';

  begin
    update public.orders set pickup_lat = 16.8478 where id = oid;
    raise exception 'FAIL: stored a pickup latitude with no longitude';
  exception when check_violation then
    raise notice 'PASS: half a pickup pin is refused';
  end;

  update public.orders set pickup_lat = 16.8478, pickup_lng = 96.1693 where id = oid;
  raise notice 'PASS: the pickup pin can be filled in later';

  -- THE GEOFENCE IS STILL THE GEOFENCE. Mandalay is 21.96 N.
  begin
    update public.orders set pickup_lat = 21.9588, pickup_lng = 96.0891 where id = oid;
    raise exception 'FAIL: a Mandalay pickup was accepted';
  exception when check_violation then
    raise notice 'PASS: an out-of-area pickup is still refused';
  end;

  /*
    AND THE PARCEL MUST STILL BE LOCATABLE. This block asserted
    `not_null_violation` when it was written, because the dropoff pin was NOT
    NULL -- and 0037 deliberately changed that, so the suite aborted here until
    it was updated. Worth keeping the story: the invariant did not disappear, it
    moved from "there is a pin" to "there is a pin OR an area".

    This order carries no `dropoff_area_id`, so clearing its pin leaves nothing
    at all -- nowhere to dispatch it, no zone to price it -- and
    `orders_dropoff_locatable` refuses exactly that. E10 covers the same rule
    from the other side, with an area and no pin.
  */
  begin
    update public.orders set dropoff_lat = null, dropoff_lng = null where id = oid;
    raise exception 'FAIL: a parcel was left with nowhere to go and no area';
  exception when check_violation then
    raise notice 'PASS: a parcel with no area cannot lose its pin either';
  end;

  delete from public.orders where id = oid;
end $$;

\echo '=== E10. a delivery needs an area, not a pin ==='
--  0037. A shop types a customer's address out of a Viber message, and
--  Nominatim finds two of six Yangon addresses -- so requiring a dropoff pin
--  required the shop to GUESS about a street it has never visited. A guessed
--  pin is worse than none, because a rider trusts it.
--
--  The AREA is the locator now and the stronger one: a pin said "somewhere in
--  Greater Yangon", an area says "South Okkalapa, which Route C visits, priced
--  4,000". So the thing to prove is that the area became MANDATORY as the pin
--  became optional -- otherwise a parcel could say nothing at all about where
--  it goes.
do $$
declare oid uuid; g text; aid uuid;
begin
  select id into aid from public.service_areas where name = 'South Okkalapa';

  insert into public.orders (shop_id, pickup_address, pickup_lat, pickup_lng,
    customer_name, customer_phone, dropoff_address, dropoff_area_id,
    parcel_desc, payment_method, cod_amount, delivery_fee, created_by)
  select id, pickup_address, pickup_lat, pickup_lng, 'No Pin Anywhere',
    '+959791110092', 'A lane off Waizayanta Road', aid,
    'unpinned parcel', 'cod', 5000, 4000, owner_id
  from public.shops where id = 'aaaaaaaa-0000-0000-0000-000000000001'
  returning id into oid;

  select coalesce(dropoff_geog::text, '(null)') into g from public.orders where id = oid;
  if g <> '(null)' then
    raise exception 'FAIL: a pinless delivery got a dropoff geography of %', g;
  end if;
  raise notice 'PASS: a delivery books on an area and an address alone';

  begin
    update public.orders set dropoff_lng = 96.1880 where id = oid;
    raise exception 'FAIL: stored a dropoff longitude with no latitude';
  exception when check_violation then
    raise notice 'PASS: half a dropoff pin is refused';
  end;

  -- THE CONSTRAINT THAT KEEPS THIS HONEST. Neither locator is not a parcel:
  -- nothing to dispatch it, no zone to price it, nothing for the office to
  -- work from. orders_insert_shop checks ownership alone, so this has to be a
  -- CHECK rather than a rule in the form.
  begin
    update public.orders set dropoff_area_id = null where id = oid;
    raise exception 'FAIL: a parcel was left with no area AND no pin';
  exception when check_violation then
    raise notice 'PASS: a parcel must have an area or a pin';
  end;

  -- And with a pin, dropping the area IS allowed: one locator is the rule.
  update public.orders set dropoff_lat = 16.8300, dropoff_lng = 96.1950 where id = oid;
  update public.orders set dropoff_area_id = null where id = oid;
  raise notice 'PASS: a pin alone satisfies it too';

  -- The fence still holds on a pin that IS given. Mandalay is 21.96 N.
  begin
    update public.orders set dropoff_lat = 21.9588, dropoff_lng = 96.0891 where id = oid;
    raise exception 'FAIL: a Mandalay delivery was accepted';
  exception when check_violation then
    raise notice 'PASS: an out-of-area delivery pin is still refused';
  end;

  delete from public.orders where id = oid;
end $$;

\echo '=== E11. a rider may note their own parcel, and cannot read the log ==='
--  0038. The collection card can already report a MISSING parcel -- that goes
--  through assigned -> failed and counts against max_collection_attempts. What
--  a rider could not do is say anything a status change does not carry:
--  "shutter closed early", "new staff", "the rest come tomorrow".
--
--  The privilege is INSERT ONLY, and that is the unusual part worth pinning.
--  order_notes holds what the OFFICE told a customer -- what was promised, what
--  was refused -- so a rider is a source for it and not an audience.
--  ITS OWN FIXTURE, deliberately. The first version of this looked for an
--  existing order per rider and aborted the suite when rider2 happened to have
--  none at this point — a test that depends on what ran before it is a test
--  that fails for reasons unrelated to what it checks.
do $$
declare a uuid; b uuid;
begin
  insert into public.orders (shop_id, pickup_address, pickup_lat, pickup_lng,
    customer_name, customer_phone, dropoff_address, dropoff_area_id,
    dropoff_lat, dropoff_lng, parcel_desc, payment_method, cod_amount,
    delivery_fee, created_by, rider_id, status)
  select s.id, s.pickup_address, s.pickup_lat, s.pickup_lng, 'Note Target A',
    '+959791110095', 'Waizayanta Road, South Okkalapa',
    (select id from public.service_areas where name = 'South Okkalapa'),
    16.8300, 96.1950, 'note fixture a', 'cod', 5000, 4000, s.owner_id,
    '44444444-4444-4444-4444-444444444444', 'assigned'
  from public.shops s where s.id = 'aaaaaaaa-0000-0000-0000-000000000001'
  returning id into a;

  insert into public.orders (shop_id, pickup_address, pickup_lat, pickup_lng,
    customer_name, customer_phone, dropoff_address, dropoff_area_id,
    dropoff_lat, dropoff_lng, parcel_desc, payment_method, cod_amount,
    delivery_fee, created_by, rider_id, status)
  select s.id, s.pickup_address, s.pickup_lat, s.pickup_lng, 'Note Target B',
    '+959791110096', 'Waizayanta Road, South Okkalapa',
    (select id from public.service_areas where name = 'South Okkalapa'),
    16.8300, 96.1950, 'note fixture b', 'cod', 5000, 4000, s.owner_id,
    '55555555-5555-5555-5555-555555555555', 'assigned'
  from public.shops s where s.id = 'aaaaaaaa-0000-0000-0000-000000000001'
  returning id into b;

  -- Handed to the rider block below through a session setting, because a DO
  -- block's variables do not outlive it.
  perform set_config('test.note_mine', a::text, false);
  perform set_config('test.note_theirs', b::text, false);
end $$;

select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}',false);
set role authenticated;
do $$
declare mine uuid; theirs uuid; n int;
begin
  mine := current_setting('test.note_mine')::uuid;
  theirs := current_setting('test.note_theirs')::uuid;

  insert into public.order_notes (order_id, author_id, author_role, kind, body)
  values (mine, '44444444-4444-4444-4444-444444444444', 'rider', 'note',
          'Shutter closed early.');
  raise notice 'PASS: a rider noted a parcel they are carrying';

  -- SOMEBODY ELSE'S PARCEL. RLS refuses the row rather than filtering it: an
  -- INSERT that fails WITH CHECK raises, it does not silently drop.
  begin
    insert into public.order_notes (order_id, author_id, author_role, kind, body)
    values (theirs, '44444444-4444-4444-4444-444444444444', 'rider', 'note', 'not mine');
    raise exception 'FAIL: a rider noted a parcel that is not theirs';
  exception when insufficient_privilege then
    raise notice 'PASS: refused on a parcel that is not theirs';
  end;

  -- AND NOT UNDER SOMEBODY ELSE'S NAME. `author_id = auth.uid()` is kept from
  -- the dispatch policy, so a note cannot be misattributed.
  begin
    insert into public.order_notes (order_id, author_id, author_role, kind, body)
    values (mine, '55555555-5555-5555-5555-555555555555', 'rider', 'note', 'signed by another');
    raise exception 'FAIL: a rider filed a note under another rider''s name';
  exception when insufficient_privilege then
    raise notice 'PASS: a note cannot be misattributed';
  end;

  -- READING STAYS THE OFFICE'S. Not an error -- SELECT is filtered, so the
  -- proof is that the row just written is invisible.
  select count(*) into n from public.order_notes;
  if n <> 0 then
    raise exception 'FAIL: a rider can read % note row(s), including the office log', n;
  end if;
  raise notice 'PASS: and cannot read the log back';
end $$;
reset role;

-- The office can see what the rider wrote: the whole point of write-only.
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',false);
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.order_notes
   where author_role = 'rider' and body = 'Shutter closed early.';
  if n < 1 then raise exception 'FAIL: the office cannot see the rider''s note'; end if;
  raise notice 'PASS: the office reads it, attributed to the rider';
end $$;
reset role;

\echo '####  ALL EDGE CHECKS PASSED  ####'
