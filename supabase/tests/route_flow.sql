-- ============================================================================
--  ROUTE / TRIP FLOW  —  migrations 0007 + 0008
--
--  plan → assign rider → load → depart (with and without the override) →
--  deliver → close → settle, plus the constraints that make the pay tables
--  unambiguous.
--
--  Run on a clean seeded DB. Replaces offer_flow.sql once 0009 retires the
--  offer engine; until then both are meaningful.
-- ============================================================================
\set ON_ERROR_STOP on

select set_config('request.jwt.claims','',false);   -- service context


-- ============================================================================
--  R0. STRUCTURE — the things that cannot be checked by reading the file
-- ============================================================================

\echo '=== R0a. btree_gist is installed in extensions ==='
do $$
begin
  if not exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                  where e.extname = 'btree_gist' and n.nspname = 'extensions') then
    raise exception 'FAIL: btree_gist missing or in the wrong schema';
  end if;
  raise notice 'PASS: btree_gist present in schema extensions';
end $$;

\echo '=== R0b. two overlapping GLOBAL pay tiers are rejected ==='
--  The whole point of the coalesce() sentinel: a bare `route_id WITH =` treats
--  NULL as "no conflict" and would let these two coexist.
do $$
begin
  insert into public.route_pay_tiers (route_id, min_parcels, max_parcels, base_pay)
  values (null, 10, 25, 99000);
  raise exception 'FAIL: overlapping global tiers accepted';
exception when exclusion_violation then
  raise notice 'PASS: overlapping global tiers refused (exclusion_violation)';
end $$;

\echo '=== R0c. a ROUTE-SPECIFIC tier may overlap a global one ==='
--  That overlap IS the override. Rejecting it would make route_id useless.
do $$
declare v_route uuid;
begin
  select id into v_route from public.routes where code = 'ROUTE_LOCAL';
  insert into public.route_pay_tiers (route_id, min_parcels, max_parcels, base_pay)
  values (v_route, 0, 19, 9000);
  raise notice 'PASS: ROUTE_LOCAL override tier accepted alongside the global 0-19 tier';
end $$;

\echo '=== R0d. two overlapping tiers on the SAME route are rejected ==='
do $$
declare v_route uuid;
begin
  select id into v_route from public.routes where code = 'ROUTE_LOCAL';
  insert into public.route_pay_tiers (route_id, min_parcels, max_parcels, base_pay)
  values (v_route, 15, 30, 12000);
  raise exception 'FAIL: overlapping same-route tiers accepted';
exception when exclusion_violation then
  raise notice 'PASS: overlapping same-route tiers refused';
end $$;

\echo '=== R0e. the override wins for its route, and only for its route ==='
do $$
declare v_local uuid; v_a uuid; q_local jsonb; q_a jsonb; q_none jsonb;
begin
  select id into v_local from public.routes where code = 'ROUTE_LOCAL';
  select id into v_a     from public.routes where code = 'ROUTE_A';

  q_local := public.quote_trip_pay(10, 0, v_local);
  q_a     := public.quote_trip_pay(10, 0, v_a);
  q_none  := public.quote_trip_pay(10, 0, null);

  if (q_local ->> 'base_pay')::bigint <> 9000 then
    raise exception 'FAIL: ROUTE_LOCAL base % , expected 9000 from the override',
      q_local ->> 'base_pay';
  end if;
  if (q_a ->> 'base_pay')::bigint <> 15000 then
    raise exception 'FAIL: ROUTE_A base % , expected the global 15000', q_a ->> 'base_pay';
  end if;
  if (q_none ->> 'base_pay')::bigint <> 15000 then
    raise exception 'FAIL: no-route base % , expected the global 15000', q_none ->> 'base_pay';
  end if;
  raise notice 'PASS: override 9000 for ROUTE_LOCAL, global 15000 elsewhere';
end $$;

-- Put the tier table back to the shipped state so the pay maths below is the
-- real one.
delete from public.route_pay_tiers where route_id is not null;

\echo '=== R0f. one primary route per area ==='
do $$
declare v_area uuid; v_route uuid;
begin
  select area_id into v_area from public.route_areas where is_primary limit 1;
  select id into v_route from public.routes where code = 'ROUTE_D';
  insert into public.route_areas (route_id, area_id, stop_order, is_primary)
  values (v_route, v_area, 99, true);
  raise exception 'FAIL: a second primary route accepted for one area';
exception when unique_violation then
  raise notice 'PASS: route_areas_primary_uk holds — one default route per area';
end $$;

\echo '=== R0g. every route hub is inside the widened geofence ==='
do $$
declare n int;
begin
  select count(*) into n from public.routes
   where not public.in_service_area(hub_lat, hub_lng);
  if n > 0 then raise exception 'FAIL: % route hubs outside the service area', n; end if;

  -- The widening is the reason routes exist at all: downtown was unreachable.
  if not public.in_service_area(16.7760, 96.1580) then
    raise exception 'FAIL: Kyauktada/Sule still outside the geofence';
  end if;
  if not public.in_service_area(17.0000, 96.1300) then
    raise exception 'FAIL: Mingaladon still outside the geofence';
  end if;
  -- ...and it is still a guard, not an open door.
  if public.in_service_area(21.9750, 96.0830) then
    raise exception 'FAIL: Mandalay accepted as in-service-area';
  end if;
  raise notice 'PASS: hubs in area; Sule and Mingaladon reachable; Mandalay rejected';
end $$;

\echo '=== R0h. foreign keys and the trip-pay uniqueness backstop exist ==='
do $$
declare n int;
begin
  select count(*) into n from pg_constraint
   where contype = 'f' and conrelid = 'public.route_areas'::regclass;
  if n <> 2 then raise exception 'FAIL: route_areas has % FKs, expected 2', n; end if;

  select count(*) into n from pg_constraint
   where contype = 'f' and conrelid = 'public.trips'::regclass;
  if n < 3 then raise exception 'FAIL: trips has only % FKs', n; end if;

  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'cod_ledger_trip_pay_uk') then
    raise exception 'FAIL: cod_ledger_trip_pay_uk missing';
  end if;
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'trips_rider_open_uk') then
    raise exception 'FAIL: trips_rider_open_uk missing';
  end if;
  raise notice 'PASS: FK graph and the trip_pay / one-open-run indexes are in place';
end $$;

\echo '=== R0i. a trip_pay line cannot be booked twice for one trip ==='
do $$
declare v_route uuid; v_trip uuid;
begin
  select id into v_route from public.routes where code = 'ROUTE_A';
  insert into public.trips (route_id, rider_id, service_date, status)
  values (v_route, '55555555-5555-5555-5555-555555555555', public.mm_today(), 'planned')
  returning id into v_trip;

  insert into public.cod_ledger (trip_id, rider_id, kind, amount, created_by)
  values (v_trip, '55555555-5555-5555-5555-555555555555', 'trip_pay', -1000,
          '11111111-1111-1111-1111-111111111111');
  begin
    insert into public.cod_ledger (trip_id, rider_id, kind, amount, created_by)
    values (v_trip, '55555555-5555-5555-5555-555555555555', 'trip_pay', -1000,
            '11111111-1111-1111-1111-111111111111');
    raise exception 'FAIL: a trip booked its pay twice';
  exception when unique_violation then
    raise notice 'PASS: cod_ledger_trip_pay_uk blocks a double booking';
  end;

  delete from public.cod_ledger where trip_id = v_trip;
  delete from public.trips where id = v_trip;
end $$;


-- ============================================================================
--  R1. quote_trip_pay — the SQL half of the TypeScript twin
--
--  These are the exact numbers pinned in lib/pricing.test.ts. If SQL and TS ever
--  disagree, one of the two suites goes red.
-- ============================================================================

\echo '=== R1. tier boundaries and the every-parcel rule ==='
do $$
declare q jsonb;
begin
  -- 0 parcels: base only, no per-parcel money
  q := public.quote_trip_pay(0, 0, null);
  if (q ->> 'total')::bigint <> 15000 then
    raise exception 'FAIL: 0 parcels -> %, expected 15000', q ->> 'total';
  end if;

  -- 19 stays in the sub-20 tier: 15000 + 19*300
  q := public.quote_trip_pay(19, 0, null);
  if (q ->> 'total')::bigint <> 20700 then
    raise exception 'FAIL: 19 parcels -> %, expected 20700', q ->> 'total';
  end if;

  -- 20 crosses into the 20000 tier: the contradiction in the spec, resolved
  -- downward. 20000 + 20*300 = 26000.
  q := public.quote_trip_pay(20, 0, null);
  if (q ->> 'total')::bigint <> 26000 then
    raise exception 'FAIL: 20 parcels -> %, expected 26000', q ->> 'total';
  end if;

  -- 39 top of the middle tier
  q := public.quote_trip_pay(39, 0, null);
  if (q ->> 'total')::bigint <> 31700 then
    raise exception 'FAIL: 39 parcels -> %, expected 31700', q ->> 'total';
  end if;

  -- 40 opens the top, open-ended tier: 25000 + 40*300
  q := public.quote_trip_pay(40, 0, null);
  if (q ->> 'total')::bigint <> 37000 then
    raise exception 'FAIL: 40 parcels -> %, expected 37000', q ->> 'total';
  end if;

  -- 60 parcels + 4 pickups: 25000 + 60*300 + 4*500 = 45000
  q := public.quote_trip_pay(60, 4, null);
  if (q ->> 'total')::bigint <> 45000 then
    raise exception 'FAIL: 60p/4u -> %, expected 45000', q ->> 'total';
  end if;
  if (q ->> 'pickup_pay')::bigint <> 2000 then
    raise exception 'FAIL: 4 pickups -> %, expected 2000', q ->> 'pickup_pay';
  end if;

  -- negatives are clamped, not an error: a UI mid-edit must not crash the quote
  q := public.quote_trip_pay(-5, -2, null);
  if (q ->> 'total')::bigint <> 15000 then
    raise exception 'FAIL: negative counts -> %, expected 15000', q ->> 'total';
  end if;

  raise notice 'PASS: 0/19/20/39/40/60 boundaries and pickup rate match lib/pricing.ts';
end $$;

\echo '=== R2. route_for_area returns the primary route ==='
do $$
declare v_got uuid; v_want uuid;
begin
  select id into v_want from public.routes where code = 'ROUTE_A';
  v_got := public.route_for_area((select id from public.service_areas
                                   where name = 'Kyauktada / Sule'));
  if v_got is distinct from v_want then
    raise exception 'FAIL: Sule resolved to % not ROUTE_A', v_got;
  end if;

  -- A Thingangyun ward sits on ROUTE_LOCAL (primary) and ROUTE_A (bonus drop).
  select id into v_want from public.routes where code = 'ROUTE_LOCAL';
  v_got := public.route_for_area((select id from public.service_areas where name = 'San Pya'));
  if v_got is distinct from v_want then
    raise exception 'FAIL: San Pya resolved to % not ROUTE_LOCAL', v_got;
  end if;

  if public.route_for_area(gen_random_uuid()) is not null then
    raise exception 'FAIL: an unmapped area resolved to a route';
  end if;
  raise notice 'PASS: Sule -> ROUTE_A, San Pya -> ROUTE_LOCAL, unmapped -> NULL';
end $$;

\echo '=== R2b. every route still carries its signed-off planning fee ==='
--  routes.per_parcel_fee is NO LONGER what a shop is billed -- 0033 moved the
--  customer price to the destination area's ZONE, because one route bundles
--  townships from both bands and cannot express two prices. What it still is:
--  the revenue side of the rider-pay margin check in lib/pricing.ts, which
--  decides whether a run is worth sending. So this stays, as a check on the
--  planning schedule; R2c below checks what the customer actually pays.
do $$
declare r record; v_expected bigint; n int := 0;
begin
  for r in
    select sa.name as area, rt.code, rt.per_parcel_fee
      from public.route_areas ra
      join public.service_areas sa on sa.id = ra.area_id
      join public.routes rt        on rt.id = ra.route_id
     where ra.is_primary and rt.is_active and sa.is_active
  loop
    v_expected := case r.code
                    when 'ROUTE_LOCAL' then 2500
                    when 'ROUTE_A'     then 3500
                    when 'ROUTE_B'     then 3500
                    when 'ROUTE_C'     then 4000
                    when 'ROUTE_D'     then 4000
                  end;
    if v_expected is null then
      raise exception 'FAIL: % maps to unknown route %', r.area, r.code;
    end if;
    if r.per_parcel_fee <> v_expected then
      raise exception 'FAIL: % on % is priced %, official is %',
        r.area, r.code, r.per_parcel_fee, v_expected;
    end if;
    n := n + 1;
  end loop;

  if n < 24 then raise exception 'FAIL: only % areas priced, expected 24', n; end if;

  -- An area with no primary route cannot be quoted at all; the order form must
  -- not offer it. Nothing should be in that state today.
  if exists (
    select 1 from public.service_areas sa
     where sa.is_active
       and not exists (select 1 from public.route_areas ra
                        where ra.area_id = sa.id and ra.is_primary)
  ) then
    raise exception 'FAIL: an active area has no primary route and cannot be priced';
  end if;

  raise notice 'PASS: all % routed areas carry the official planning fee', n;
end $$;


\echo '=== R2c. every bookable area prices to the ZONE rate card (shop billing) ==='
--  THE CUSTOMER PRICE, and the check that replaces the old per-route one. It
--  walks exactly the join `resolveAreaRoute` walks -- area -> zone -- and
--  asserts the fee is one of the two figures on the printed card. A silent
--  wrong fee here is an invoice dispute weeks later, which is why refusing to
--  quote is the designed behaviour and why there is no default to fall back on.
do $$
declare r record; n int := 0;
begin
  for r in
    select sa.name as area, z.code as zone, z.fee, z.delivery_days
      from public.service_areas sa
      join public.delivery_zones z on z.id = sa.zone_id
     where sa.is_active
  loop
    if r.zone = 'ZONE_1' and r.fee <> 4000 then
      raise exception 'FAIL: % is Zone 1 but priced %, card says 4000', r.area, r.fee;
    end if;
    if r.zone = 'ZONE_2' and r.fee <> 5000 then
      raise exception 'FAIL: % is Zone 2 but priced %, card says 5000', r.area, r.fee;
    end if;
    if r.delivery_days <> 3 then
      raise exception 'FAIL: % promises % days, card says 3', r.area, r.delivery_days;
    end if;
    n := n + 1;
  end loop;
  if n < 24 then raise exception 'FAIL: only % active areas zoned, expected 24+', n; end if;
  raise notice 'PASS: all % active areas price to the zone rate card', n;
end $$;


\echo '=== R2d. the townships the card is specific about land in the right band ==='
--  THE CLARIFICATIONS, pinned. Each of these was a judgement call rather than
--  something derivable from the name, and getting one wrong misprices a real
--  merchant by 1,000 Ks a parcel:
--
--    Dagon           non-extended is Zone 1; "(extended)" is Zone 2
--    Shwepyitha      Zone 1; "Shwe Pyi Thar (extended)" and its Industrial
--                    pocket are two different places, both Zone 2
--    Thingangyun     the industrial variant is Zone 1, not an outlying pocket
do $$
declare r record; v_fee bigint;
begin
  for r in
    select * from (values
      ('Dagon',                     4000),
      ('North Dagon',               4000),
      ('South Dagon',               4000),
      ('Dagon Seikkan',             4000),
      ('North Dagon (extended)',    5000),
      ('South Dagon (extended)',    5000),
      ('Dagon Seikkan (extended)',  5000),
      ('Shwepyitha',                4000),
      ('Shwe Pyi Thar (extended)',  5000),
      ('Shwe Pyi Thar Industrial',  5000),
      ('Hlaingtharyar',             4000),
      ('Hlaing Thar Yar (extended)',5000),
      ('Thingangyun',               4000),
      ('Thingangyun Industrial',    4000),
      ('Thanlyin',                  5000),
      ('Kamayut',                   4000),
      ('Kyauktada / Sule',          4000)
    ) as v(area, fee)
  loop
    select z.fee into v_fee
      from public.service_areas sa
      join public.delivery_zones z on z.id = sa.zone_id
     where sa.name = r.area;
    if v_fee is null then
      raise exception 'FAIL: % is on the rate card but not in service_areas', r.area;
    end if;
    if v_fee <> r.fee then
      raise exception 'FAIL: % is priced %, the card says %', r.area, v_fee, r.fee;
    end if;
  end loop;
  raise notice 'PASS: all 17 named rate-card areas land in the right zone';
end $$;


\echo '=== R2e. an area cannot exist without a price, and a zone in use cannot vanish ==='
do $$
declare n int; z_id uuid;
begin
  -- NOT NULL, not merely refused by the application. An unzoned area would drop
  -- out of the shop's booking list silently and the admin who created it would
  -- never learn why; the constraint puts the failure where it can be fixed.
  begin
    insert into public.service_areas (name, kind) values ('Nowhere', 'township');
    raise exception 'FAIL: an area was created with no delivery zone';
  exception when not_null_violation then
    raise notice 'PASS: an area cannot be created without a zone';
  end;

  -- ON DELETE RESTRICT. Dropping a zone that still prices areas would leave
  -- them unpriceable; reassign first.
  select id into z_id from public.delivery_zones where code = 'ZONE_1';
  begin
    delete from public.delivery_zones where id = z_id;
    raise exception 'FAIL: a zone still pricing areas was deleted';
  exception when foreign_key_violation then
    raise notice 'PASS: a zone in use cannot be deleted';
  end;

  -- And every area really does have one, which is what makes the app's refusal
  -- path dead code in practice rather than a state to design around.
  select count(*) into n from public.service_areas where zone_id is null;
  if n <> 0 then raise exception 'FAIL: % area(s) have no zone', n; end if;
  raise notice 'PASS: every area is priced';
end $$;


-- ============================================================================
--  R3. FIXTURES — 25 downtown parcels for ROUTE_A
-- ============================================================================

\echo '=== R3. 40 parcels created for Kyauktada / Sule ==='
insert into public.orders (
  shop_id, pickup_address, pickup_lat, pickup_lng,
  customer_name, customer_phone, dropoff_address, dropoff_area_id,
  dropoff_lat, dropoff_lng, parcel_desc, payment_method, cod_amount,
  delivery_fee, created_by
)
select
  'aaaaaaaa-0000-0000-0000-000000000001',
  'No. 24, Thitsar Road, San Pya Ward, Thingangyun, Yangon', 16.8478, 96.1693,
  'Route Customer ' || g,
  '+95979' || lpad(g::text, 7, '0'),
  'Shop ' || g || ', Sule Pagoda Road, Kyauktada, Yangon',
  (select id from public.service_areas where name = 'Kyauktada / Sule'),
  16.7760, 96.1580,
  'Downtown parcel ' || g,
  'cod', 12000,
  -- the official ROUTE_A schedule
  3500,
  '33333333-3333-3333-3333-333333333333'
from generate_series(1, 40) g;

do $$
declare n int;
begin
  select count(*) into n from public.orders where status = 'pending' and trip_id is null;
  if n < 40 then raise exception 'FAIL: only % unrouted parcels', n; end if;
  raise notice 'PASS: % unrouted parcels waiting', n;
end $$;


-- ============================================================================
--  R4. plan / assign / load
-- ============================================================================

\echo '=== R4a. plan_trip opens a planned run ==='
do $$
declare t public.trips;
begin
  t := public.plan_trip((select id from public.routes where code = 'ROUTE_A'));
  if t.status <> 'planned' then raise exception 'FAIL: status %', t.status; end if;
  if t.service_date <> public.mm_today() then
    raise exception 'FAIL: service_date % not today Yangon', t.service_date;
  end if;
  raise notice 'PASS: trip planned for % on ROUTE_A', t.service_date;
end $$;

\echo '=== R4b. an inactive route cannot be planned ==='
do $$
begin
  update public.routes set is_active = false where code = 'ROUTE_D';
  perform public.plan_trip((select id from public.routes where code = 'ROUTE_D'));
  raise exception 'FAIL: planned a run on an inactive route';
exception when sqlstate '55000' then
  raise notice 'PASS: plan_trip refused an inactive route';
end $$;
update public.routes set is_active = true where code = 'ROUTE_D';

\echo '=== R4c. load_trip attaches parcels and moves the run to loading ==='
do $$
declare t public.trips; ids uuid[]; n int;
begin
  select id into t.id from public.trips where status = 'planned' order by created_at desc limit 1;
  t := public.assign_trip_rider(t.id, '44444444-4444-4444-4444-444444444444');
  if t.rider_id is null then raise exception 'FAIL: rider not set'; end if;

  select array_agg(o.id) into ids from (
    select id from public.orders where status = 'pending' and trip_id is null limit 14
  ) o;
  -- 0028: these came in on an earlier collection run. A delivery leg
  -- may only carry parcels the hub is already holding.
  update public.orders set picked_up_at = coalesce(picked_up_at, now())
   where id = any(ids);
  t := public.load_trip(t.id, ids, 'delivery');
  if t.status <> 'loading' then raise exception 'FAIL: status %', t.status; end if;

  select count(*) into n from public.orders
   where trip_id = t.id and status = 'assigned' and trip_leg = 'delivery';
  if n <> 14 then raise exception 'FAIL: % parcels assigned, expected 14', n; end if;
  raise notice 'PASS: 14 parcels loaded and assigned to the trip rider';
end $$;

\echo '=== R4d. trip parcels do NOT consume rider capacity ==='
--  0007 §10: the trip is the capacity unit. max_active_orders is CHECKed at
--  1..10 and a run carries 20-60, so counting these would make loading
--  impossible — and tg_orders_audit's release is guarded on trip_id being NULL,
--  so incrementing here would leave the counter permanently high.
do $$
declare v_count int; v_avail public.rider_availability;
begin
  select active_order_count, availability into v_count, v_avail
    from public.rider_profiles where id = '44444444-4444-4444-4444-444444444444';
  if v_count <> 0 then
    raise exception 'FAIL: active_order_count % after loading 14 trip parcels', v_count;
  end if;
  if v_avail <> 'available' then
    raise exception 'FAIL: rider marked % by a trip load', v_avail;
  end if;
  raise notice 'PASS: active_order_count still 0, rider still available';
end $$;

\echo '=== R4e. an already-loaded parcel cannot be loaded again ==='
do $$
declare t_id uuid; ids uuid[];
begin
  select id into t_id from public.trips where status = 'loading' order by created_at desc limit 1;
  select array_agg(id) into ids from public.orders where trip_id = t_id limit 1;
  -- 0028: these came in on an earlier collection run. A delivery leg
  -- may only carry parcels the hub is already holding.
  update public.orders set picked_up_at = coalesce(picked_up_at, now())
   where id = any(ids);
  perform public.load_trip(t_id, ids, 'delivery');
  raise exception 'FAIL: double-loaded a parcel';
exception when sqlstate '55000' then
  raise notice 'PASS: load_trip refused a parcel already on a run';
end $$;

\echo '=== R4f. the per-trip COD ceiling is enforced at load ==='
do $$
declare t_id uuid; oid uuid; before_cod bigint;
begin
  select id into t_id from public.trips where status = 'loading' order by created_at desc limit 1;

  -- One parcel worth more than the whole route ceiling.
  insert into public.orders (
    shop_id, pickup_address, pickup_lat, pickup_lng, customer_name, customer_phone,
    dropoff_address, dropoff_area_id, dropoff_lat, dropoff_lng, parcel_desc,
    payment_method, cod_amount, delivery_fee, created_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
    'No. 24, Thitsar Road, San Pya Ward, Thingangyun, Yangon', 16.8478, 96.1693,
    'Big Ticket', '+959790009999',
    'Sule Pagoda Road, Kyauktada, Yangon',
    (select id from public.service_areas where name = 'Kyauktada / Sule'),
    16.7760, 96.1580, 'Gold chain', 'cod', 2500000, 3500,
    '33333333-3333-3333-3333-333333333333')
  returning id into oid;

  begin
    -- 0028: these came in on an earlier collection run. A delivery leg
    -- may only carry parcels the hub is already holding.
    update public.orders set picked_up_at = coalesce(picked_up_at, now())
     where id = any(array[oid]);
    perform public.load_trip(t_id, array[oid], 'delivery');
    raise exception 'FAIL: loaded past max_cod_per_trip';
  exception when sqlstate '55000' then
    raise notice 'PASS: load_trip refused 2,500,000 Ks against a 2,000,000 ceiling';
  end;

  -- and it did not half-attach anything
  if (select trip_id from public.orders where id = oid) is not null then
    raise exception 'FAIL: the refused parcel was attached anyway';
  end if;
  delete from public.orders where id = oid;
end $$;

\echo '=== R4g. the per-trip parcel ceiling is enforced at load ==='
do $$
declare t_id uuid; ids uuid[];
begin
  select id into t_id from public.trips where status = 'loading' order by created_at desc limit 1;
  update public.routes set max_parcels_per_trip = 15 where code = 'ROUTE_A';

  select array_agg(o.id) into ids from (
    select id from public.orders where status = 'pending' and trip_id is null limit 5
  ) o;
  begin
    -- 0028: these came in on an earlier collection run. A delivery leg
    -- may only carry parcels the hub is already holding.
    update public.orders set picked_up_at = coalesce(picked_up_at, now())
     where id = any(ids);
    perform public.load_trip(t_id, ids, 'delivery');
    raise exception 'FAIL: loaded 19 parcels against a 15 ceiling';
  exception when sqlstate '55000' then
    raise notice 'PASS: load_trip refused 19 parcels against max_parcels_per_trip 15';
  end;
  update public.routes set max_parcels_per_trip = 60 where code = 'ROUTE_A';
end $$;

\echo '=== R4h. unload_trip returns parcels to the unrouted pool ==='
do $$
declare t_id uuid; ids uuid[]; n int;
begin
  select id into t_id from public.trips where status = 'loading' order by created_at desc limit 1;
  select array_agg(id) into ids from (
    select id from public.orders where trip_id = t_id limit 2) x;
  perform public.unload_trip(t_id, ids);

  select count(*) into n from public.orders
   where id = any(ids) and trip_id is null and status = 'pending' and rider_id is null;
  if n <> 2 then raise exception 'FAIL: % of 2 parcels unloaded cleanly', n; end if;

  select count(*) into n from public.orders where trip_id = t_id;
  if n <> 12 then raise exception 'FAIL: % parcels left on the run, expected 12', n; end if;

  -- and unloading must not have driven the capacity counter negative
  if (select active_order_count from public.rider_profiles
       where id = '44444444-4444-4444-4444-444444444444') <> 0 then
    raise exception 'FAIL: active_order_count moved on unload';
  end if;
  raise notice 'PASS: 2 parcels unloaded, 12 remain, capacity counter still 0';
end $$;


-- ============================================================================
--  R4i. THE RUN OWNS THE RIDER  (migration 0015)
--
--  Found live: a run reassigned from one rider to another kept every already
--  loaded parcel on the FIRST rider, because the re-stamp only matched
--  `pending` and `failed`. The new rider saw an empty dashboard; the old one
--  could still deliver the parcels and collect the cash, while close_trip paid
--  the new one for the run. Two settlements wrong in opposite directions.
-- ============================================================================

\echo '=== R4i. swapping the rider brings the loaded parcels along ==='
do $$
declare t_id uuid; n int; v_wrong int;
begin
  select id into t_id from public.trips where status = 'loading' order by created_at desc limit 1;

  -- Everything on the run is already `assigned` to rider1 — which is exactly the
  -- state the old filter skipped.
  select count(*) into n from public.orders
   where trip_id = t_id and status = 'assigned'
     and rider_id = '44444444-4444-4444-4444-444444444444';
  if n = 0 then raise exception 'FAIL: fixture is not in the state under test'; end if;

  perform public.assign_trip_rider(t_id, '55555555-5555-5555-5555-555555555555');

  select count(*) into v_wrong from public.orders
   where trip_id = t_id and status <> 'cancelled'
     and rider_id is distinct from '55555555-5555-5555-5555-555555555555';
  if v_wrong > 0 then
    raise exception 'FAIL: % parcel(s) stayed with the old rider', v_wrong;
  end if;
  raise notice 'PASS: % parcels moved with the run to the new rider', n;

  -- Put it back; the rest of the file expects rider1 on this run.
  perform public.assign_trip_rider(t_id, '44444444-4444-4444-4444-444444444444');
end $$;

\echo '=== R4i2. and the invariant cannot be broken by hand ==='
--  The trigger is DEFERRABLE INITIALLY DEFERRED, so it fires at COMMIT and not
--  on the UPDATE. That is deliberate — assign_trip_rider writes `trips` and
--  `orders` in separate statements and they legitimately disagree in between —
--  but it means the failure cannot be caught by a PL/pgSQL exception handler.
--  So this one is tested where it actually happens: at commit.
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.orders'::regclass
       and tgname  = 'orders_rider_matches_trip'
       and tgdeferrable and tginitdeferred) then
    raise exception 'FAIL: orders_rider_matches_trip is missing or not deferred';
  end if;
  raise notice 'PASS: the constraint trigger exists and is deferred to commit';
end $$;

select id as r4i2_order from public.orders
 where trip_id = (select id from public.trips where status = 'loading'
                   order by created_at desc limit 1)
 limit 1 \gset

\echo '--- the ERROR on the next line is the point of this test: the commit must fail ---'
\set ON_ERROR_STOP off
begin;
update public.orders set rider_id = '55555555-5555-5555-5555-555555555555'
 where id = :'r4i2_order';
commit;                       -- must fail: the run belongs to rider1
\set ON_ERROR_STOP on

do $$
declare v_rider uuid;
begin
  select rider_id into v_rider from public.orders
   where id = (select id from public.orders
                where trip_id = (select id from public.trips where status = 'loading'
                                  order by created_at desc limit 1)
                limit 1);
  if v_rider <> '44444444-4444-4444-4444-444444444444' then
    raise exception 'FAIL: the mismatch was committed (rider is now %)', v_rider;
  end if;
  raise notice 'PASS: the commit was refused and the parcel still names the run''s rider';
end $$;

\echo '=== R4i3. a riderless run clears a rider left over from a past attempt ==='
do $$
declare t_id uuid; o_id uuid; v_rider uuid;
begin
  -- close_trip leaves a parcel held at the attempt cap as `failed` WITH its old
  -- rider_id. Loading that onto a run that has no rider yet used to keep the
  -- stale name (`coalesce(v_t.rider_id, o.rider_id)`).
  select id into o_id from public.orders
   where trip_id is null and status = 'pending' limit 1;
  update public.orders set rider_id = '66666666-6666-6666-6666-666666666666'
   where id = o_id;

  t_id := (public.plan_trip((select route_id from public.trips
                              where status = 'loading' order by created_at desc limit 1),
                            public.mm_today() + 1)).id;
  -- 0028: these came in on an earlier collection run. A delivery leg
  -- may only carry parcels the hub is already holding.
  update public.orders set picked_up_at = coalesce(picked_up_at, now())
   where id = any(array[o_id]);
  perform public.load_trip(t_id, array[o_id], 'delivery');

  select rider_id into v_rider from public.orders where id = o_id;
  if v_rider is not null then
    raise exception 'FAIL: a riderless run kept the stale rider %', v_rider;
  end if;

  perform public.cancel_trip(t_id, 'R4i3 fixture');
  raise notice 'PASS: loading onto a riderless run clears the old rider';
end $$;


-- ============================================================================
--  R5. depart_trip — THE 20-PARCEL GATE
-- ============================================================================

--  0039 CHANGED WHAT THIS SECTION ASSERTS. `depart_trip` used to REFUSE a short
--  run that gave no reason, and R5a pinned that refusal. The reason is now
--  optional -- the margin guard is worth seeing, not worth a written
--  justification addressed to the person who already decided.
--
--  So the old R5a is gone and R5c below takes its place from the other side:
--  the run departs, and the audit row still records the shortfall and the
--  money. THAT is the invariant that mattered, and it is the one now pinned.
--  What is NOT relaxed: a reason that is supplied must still say something.

\echo '=== R5a. a token reason is still not an override ==='
do $$
declare t_id uuid;
begin
  select id into t_id from public.trips where status = 'loading' order by created_at desc limit 1;
  perform public.depart_trip(t_id, 'ok');
  raise exception 'FAIL: a 2-character override was accepted';
exception when sqlstate '22023' then
  raise notice 'PASS: depart_trip still refused a 2-character override reason';
end $$;

\echo '=== R5b. the run departs on an override, and the override is recorded ==='
do $$
declare t public.trips; v_audit jsonb;
begin
  select id into t.id from public.trips where status = 'loading' order by created_at desc limit 1;
  t := public.depart_trip(t.id, 'Customer promised same-day; going short deliberately.');

  if t.status <> 'departed' then raise exception 'FAIL: status %', t.status; end if;
  if t.departed_at is null then raise exception 'FAIL: departed_at not set'; end if;
  if t.depart_parcel_count <> 12 then
    raise exception 'FAIL: depart_parcel_count %, expected 12', t.depart_parcel_count;
  end if;
  if t.depart_override_reason is null then
    raise exception 'FAIL: override reason not stored on the trip';
  end if;

  select after into v_audit from public.audit_log
   where action = 'trip.depart_below_minimum' and entity_id = t.id::text
   order by created_at desc limit 1;
  if v_audit is null then raise exception 'FAIL: no audit row for the override'; end if;
  if (v_audit ->> 'parcels')::int <> 12 then
    raise exception 'FAIL: audit parcels %', v_audit ->> 'parcels';
  end if;
  if (v_audit ->> 'shortfall')::int <> 8 then
    raise exception 'FAIL: audit shortfall %, expected 8', v_audit ->> 'shortfall';
  end if;
  -- 12 parcels: 15000 + 12*300 = 18600 pay against 12*3500 = 42000 of fees.
  -- Profitable but short — that distinction is the point of the gate.
  if (v_audit ->> 'projected_pay')::bigint <> 18600 then
    raise exception 'FAIL: audit projected_pay %, expected 18600', v_audit ->> 'projected_pay';
  end if;
  if (v_audit ->> 'projected_margin')::bigint <> 23400 then
    raise exception 'FAIL: audit projected_margin %, expected 23400',
      v_audit ->> 'projected_margin';
  end if;
  raise notice 'PASS: departed 12/20 on override; audit records 8 short, 18600 pay, 23400 margin';
end $$;

\echo '=== R5c. 0039 — a short run departs with NO reason, and is still recorded ==='
--  The half of the old R5a that survives. Nobody is made to type; the trail is
--  kept. `depart_override_reason` is null because none was given, and the
--  audit row is what distinguishes "went short quietly" from "met the rule" --
--  R5g asserts the compliant case writes no such row at all.
do $$
declare t public.trips; ids uuid[]; v_audit jsonb; n int;
begin
  select array_agg(o.id) into ids from (
    select id from public.orders where status = 'pending' and trip_id is null limit 2) o;
  if coalesce(array_length(ids, 1), 0) < 1 then
    raise notice 'SKIP: no pending parcels left to build a short run';
    return;
  end if;

  t := public.plan_trip((select id from public.routes where code = 'ROUTE_D'));
  t := public.assign_trip_rider(t.id, '66666666-6666-6666-6666-666666666666');
  -- A delivery leg may only carry what the hub already holds (0028).
  update public.orders set picked_up_at = coalesce(picked_up_at, now())
   where id = any(ids);
  t := public.load_trip(t.id, ids, 'delivery');

  -- No second argument. Before 0039 this raised trip_below_minimum.
  t := public.depart_trip(t.id);

  if t.status <> 'departed' then
    raise exception 'FAIL: a short run with no reason did not depart: %', t.status;
  end if;
  if t.depart_override_reason is not null then
    raise exception 'FAIL: a reason was invented: %', t.depart_override_reason;
  end if;

  select after into v_audit from public.audit_log
   where action = 'trip.depart_below_minimum' and entity_id = t.id::text
   order by created_at desc limit 1;
  if v_audit is null then
    raise exception 'FAIL: short departure left no audit row — the trail is the point';
  end if;
  if (v_audit ->> 'shortfall')::int <> 20 - array_length(ids, 1) then
    raise exception 'FAIL: audit shortfall %, expected %',
      v_audit ->> 'shortfall', 20 - array_length(ids, 1);
  end if;
  if v_audit ? 'reason' and (v_audit ->> 'reason') is not null then
    raise exception 'FAIL: audit recorded a reason nobody gave: %', v_audit ->> 'reason';
  end if;
  -- The money is still captured at the moment of the decision.
  if (v_audit ->> 'projected_pay') is null or (v_audit ->> 'projected_margin') is null then
    raise exception 'FAIL: audit lost the projected pay/margin';
  end if;

  select count(*) into n from public.audit_log
   where action = 'trip.depart' and entity_id = t.id::text;
  if n <> 0 then
    raise exception 'FAIL: a short run wrote BOTH audit rows — they are either/or';
  end if;

  raise notice 'PASS: % parcels departed with no reason; shortfall still audited',
    array_length(ids, 1);
end $$;

\echo '=== R5d. a departed run cannot depart again ==='
do $$
declare t_id uuid;
begin
  select id into t_id from public.trips where status = 'departed' order by created_at desc limit 1;
  perform public.depart_trip(t_id, 'Trying to send it out twice for no reason.');
  raise exception 'FAIL: a departed run departed again';
exception when sqlstate '55000' then
  raise notice 'PASS: depart_trip refused an already-departed run';
end $$;

\echo '=== R5e. an empty run cannot depart at all ==='
do $$
declare t public.trips;
begin
  t := public.plan_trip((select id from public.routes where code = 'ROUTE_B'));
  t := public.assign_trip_rider(t.id, '55555555-5555-5555-5555-555555555555');
  begin
    perform public.depart_trip(t.id, 'Nothing to carry but going anyway, honestly.');
    raise exception 'FAIL: an empty run departed';
  exception when sqlstate '55000' then
    raise notice 'PASS: depart_trip refused an empty run even with a reason';
  end;
  perform public.cancel_trip(t.id, 'test fixture');
end $$;

\echo '=== R5f. a run with no rider cannot depart ==='
do $$
declare t public.trips; ids uuid[];
begin
  t := public.plan_trip((select id from public.routes where code = 'ROUTE_C'));
  select array_agg(o.id) into ids from (
    select id from public.orders where status = 'pending' and trip_id is null limit 2) o;
  -- 0028: these came in on an earlier collection run. A delivery leg
  -- may only carry parcels the hub is already holding.
  update public.orders set picked_up_at = coalesce(picked_up_at, now())
   where id = any(ids);
  t := public.load_trip(t.id, ids, 'delivery');

  -- attached, but still pending: no rider means no assignment
  if (select count(*) from public.orders where trip_id = t.id and status = 'pending') <> 2 then
    raise exception 'FAIL: parcels assigned without a rider';
  end if;
  begin
    perform public.depart_trip(t.id, 'No rider yet but sending it out regardless.');
    raise exception 'FAIL: a riderless run departed';
  exception when sqlstate '55000' then
    raise notice 'PASS: depart_trip refused a run with no rider; parcels stayed pending';
  end;
  perform public.cancel_trip(t.id, 'test fixture');
end $$;

\echo '=== R5g. a run at or above the minimum departs with nothing recorded ==='
do $$
declare t public.trips; ids uuid[]; n int;
begin
  t := public.plan_trip((select id from public.routes where code = 'ROUTE_A'));
  t := public.assign_trip_rider(t.id, '55555555-5555-5555-5555-555555555555');
  select array_agg(o.id) into ids from (
    select id from public.orders where status = 'pending' and trip_id is null limit 20) o;
  if array_length(ids, 1) <> 20 then
    raise exception 'FAIL: only % parcels available for the full run', array_length(ids, 1);
  end if;
  -- 0028: these came in on an earlier collection run. A delivery leg
  -- may only carry parcels the hub is already holding.
  update public.orders set picked_up_at = coalesce(picked_up_at, now())
   where id = any(ids);
  t := public.load_trip(t.id, ids, 'delivery');
  t := public.depart_trip(t.id);

  if t.status <> 'departed' then raise exception 'FAIL: status %', t.status; end if;
  if t.depart_override_reason is not null then
    raise exception 'FAIL: an override was recorded for a compliant run';
  end if;
  select count(*) into n from public.audit_log
   where action = 'trip.depart_below_minimum' and entity_id = t.id::text;
  if n <> 0 then raise exception 'FAIL: % below-minimum audit rows for a 20-parcel run', n; end if;
  raise notice 'PASS: 20/20 departed clean — no override, no below-minimum audit row';
end $$;

\echo '=== R5h2. 0039 — a DEPARTED run still takes parcels ==='
--  THE ASYMMETRY THIS CLOSES. `unload_trip` has always accepted a departed run;
--  `load_trip` refused one. Parcels could come off a moving bike but never on,
--  so a parcel booked at 10:40 waited for tomorrow while the rider who could
--  have carried it rode past the door.
--
--  Loading late must NOT be a way around anything: the run stays departed, the
--  parcel takes the run's rider, and the ceilings still bite. R5h3 checks the
--  last of those.
do $$
declare t public.trips; t_id uuid; o_id uuid; before_status text; n int;
begin
  select id, status into t_id, before_status
    from public.trips where status = 'departed' and depart_parcel_count = 12 limit 1;
  if t_id is null then
    raise notice 'SKIP: no departed run to top up';
    return;
  end if;

  select id into o_id from public.orders
   where status = 'pending' and trip_id is null and picked_up_at is null limit 1;
  if o_id is null then
    raise notice 'SKIP: no uncollected parcel left to add';
    return;
  end if;

  -- A brand-new parcel is still at its shop, so it joins as a COLLECTION.
  -- That is the right leg: the rider goes and fetches it.
  t := public.load_trip(t_id, array[o_id], 'pickup');

  if t.status <> 'departed' then
    raise exception 'FAIL: topping up reversed the run to %', t.status;
  end if;
  select count(*) into n from public.orders
   where id = o_id and trip_id = t_id and trip_leg = 'pickup'
     and status = 'assigned' and rider_id = t.rider_id;
  if n <> 1 then
    raise exception 'FAIL: the late parcel did not land assigned to the run''s rider';
  end if;

  -- Take it back off so R6's pay arithmetic still sees exactly 12 parcels.
  perform public.unload_trip(t_id, array[o_id]);
  raise notice 'PASS: a departed run accepted a parcel, stayed departed, kept its rider';
end $$;

\echo '=== R5h3. and loading late is not a way around the ceilings ==='
do $$
declare t_id uuid; o_id uuid; v_max bigint; v_cod bigint;
begin
  select id into t_id from public.trips
   where status = 'departed' and depart_parcel_count = 12 limit 1;
  if t_id is null then raise notice 'SKIP: no departed run'; return; end if;

  select r.max_cod_per_trip into v_max
    from public.routes r join public.trips t on t.route_id = r.id where t.id = t_id;
  select coalesce(sum(cod_amount), 0) into v_cod from public.orders where trip_id = t_id;

  select id into o_id from public.orders
   where status = 'pending' and trip_id is null and picked_up_at is null limit 1;
  if o_id is null then raise notice 'SKIP: no parcel to test the ceiling with'; return; end if;

  -- Push this one parcel past the run's cash ceiling on its own.
  update public.orders set cod_amount = v_max - v_cod + 1000, payment_method = 'cod'
   where id = o_id;
  begin
    perform public.load_trip(t_id, array[o_id], 'pickup');
    raise exception 'FAIL: a departed run took a parcel over its cash ceiling';
  exception when sqlstate '55000' then
    raise notice 'PASS: the COD ceiling still refuses a late load';
  end;
end $$;

\echo '=== R5h. one rider cannot be out on two runs ==='
do $$
declare t public.trips;
begin
  t := public.plan_trip((select id from public.routes where code = 'ROUTE_D'));
  begin
    perform public.assign_trip_rider(t.id, '55555555-5555-5555-5555-555555555555');
    raise exception 'FAIL: a rider was put on a second open run';
  exception when sqlstate '55000' then
    raise notice 'PASS: assign_trip_rider refused a rider already out';
  end;
  perform public.cancel_trip(t.id, 'test fixture');
end $$;


-- ============================================================================
--  R6. close_trip — the pay event
-- ============================================================================

\echo '=== R6a. a run with parcels still in flight cannot close ==='
do $$
declare t_id uuid;
begin
  select id into t_id from public.trips
   where status = 'departed' and depart_parcel_count = 12 limit 1;
  perform public.close_trip(t_id);
  raise exception 'FAIL: closed a run with 12 parcels unaccounted for';
exception when sqlstate '55000' then
  raise notice 'PASS: close_trip refused a run with open parcels';
end $$;

\echo '=== R6b. deliver 11, fail 1, then close: pay is snapshotted ==='
do $$
declare
  t     public.trips;
  t_id  uuid;
  r     record;
  i     int := 0;
begin
  select id into t_id from public.trips
   where status = 'departed' and depart_parcel_count = 12 limit 1;

  for r in select id from public.orders where trip_id = t_id order by created_at loop
    i := i + 1;
    perform public.advance_order(r.id, 'picked_up');
    if i <= 11 then
      perform public.advance_order(r.id, 'delivered', 16.776, 96.158,
                                   r.id::text || '/proof.webp', 'Received');
    else
      perform public.advance_order(r.id, 'failed', null, null, null, null,
                                   'Nobody home after three calls');
    end if;
  end loop;

  t := public.return_trip(t_id);
  if t.status <> 'returned' then raise exception 'FAIL: status %', t.status; end if;

  t := public.close_trip(t_id);
  if t.status <> 'closed' then raise exception 'FAIL: status %', t.status; end if;

  -- A failed delivery still counts: the rider rode to the address.
  if t.parcel_count <> 12 then
    raise exception 'FAIL: parcel_count %, expected 12 (11 delivered + 1 failed)', t.parcel_count;
  end if;
  -- 15000 base (sub-20 tier) + 12 * 300
  if t.base_pay <> 15000 then raise exception 'FAIL: base_pay %', t.base_pay; end if;
  if t.parcel_pay <> 3600 then raise exception 'FAIL: parcel_pay %', t.parcel_pay; end if;
  if t.total_pay <> 18600 then raise exception 'FAIL: total_pay %', t.total_pay; end if;
  if t.pay_tier_snapshot is null then raise exception 'FAIL: no tier snapshot'; end if;
  raise notice 'PASS: closed at 12 parcels — 15000 + 3600 = 18600, tier snapshotted';
end $$;

\echo '=== R6b2. the failed parcel is released back to the pool (0010) ==='
--  Before 0010 a failed parcel stayed bound to its closed trip forever: the
--  planning board's pool is `trip_id is null` and load_trip refuses anything
--  with a trip_id, so nobody could see it and nobody could redeliver it.
--
--  It must come back WITHOUT costing the rider the pay for the attempt — they
--  rode to the address either way. R6b above already asserted parcel_count = 12,
--  which includes this one.
do $$
declare v_stuck int; v_free int; t_id uuid;
begin
  select id into t_id from public.trips where status = 'closed' limit 1;

  select count(*) into v_stuck
    from public.orders o join public.trips t on t.id = o.trip_id
   where o.status = 'failed' and t.status = 'closed';
  if v_stuck > 0 then
    raise exception 'FAIL: % failed parcels still attached to a closed trip', v_stuck;
  end if;

  -- Released parcels go back to `pending`, which is what puts them in the pool.
  select count(*) into v_free from public.orders
   where trip_id is null and status = 'pending' and rider_id is null;
  if v_free < 1 then
    raise exception 'FAIL: the failed parcel did not return to the unrouted pool';
  end if;

  -- ...and releasing must not have driven the capacity counter negative.
  if exists (select 1 from public.rider_profiles where active_order_count < 0) then
    raise exception 'FAIL: a capacity counter went negative on release';
  end if;

  -- The rescue is recorded, so an operator can see it happened.
  if not exists (select 1 from public.audit_log
                  where action = 'trip.close' and entity_id = t_id::text
                    and (after ->> 'released_for_retry')::int = 1) then
    raise exception 'FAIL: the close audit row does not record the release';
  end if;

  raise notice 'PASS: failed parcel released to the pool, rider still paid for it';
end $$;

\echo '=== R6c. exactly one trip_pay line, negative, with no order behind it ==='
do $$
declare t_id uuid; n int; v_amt bigint; n_with_order int;
begin
  select id into t_id from public.trips where status = 'closed' limit 1;
  select count(*), min(amount), count(order_id)
    into n, v_amt, n_with_order
    from public.cod_ledger where trip_id = t_id and kind = 'trip_pay';
  if n <> 1 then raise exception 'FAIL: % trip_pay lines', n; end if;
  if v_amt <> -18600 then raise exception 'FAIL: trip_pay amount %, expected -18600', v_amt; end if;
  if n_with_order <> 0 then raise exception 'FAIL: trip_pay line carries an order_id'; end if;
  raise notice 'PASS: one trip_pay line of -18600, order_id NULL';
end $$;

\echo '=== R6d. route parcels booked COD but NO per-order commission ==='
--  This is what makes trip pay and commission pay mutually exclusive: the
--  commission columns stay NULL on a route order, so tg_orders_audit skips the
--  commission line and the rider is paid once per run instead of once per parcel.
do $$
declare t_id uuid; n_cod int; n_com int;
begin
  select id into t_id from public.trips where status = 'closed' limit 1;
  select count(*) into n_cod from public.cod_ledger l
    join public.orders o on o.id = l.order_id
   where o.trip_id = t_id and l.kind = 'cod_collected';
  select count(*) into n_com from public.cod_ledger l
    join public.orders o on o.id = l.order_id
   where o.trip_id = t_id and l.kind = 'commission_earned';

  if n_cod <> 11 then raise exception 'FAIL: % cod_collected lines, expected 11', n_cod; end if;
  if n_com <> 0 then raise exception 'FAIL: % commission lines on a route run', n_com; end if;
  raise notice 'PASS: 11 cod_collected lines, 0 commission lines';
end $$;

\echo '=== R6e. a closed run cannot be closed again ==='
do $$
declare t_id uuid;
begin
  select id into t_id from public.trips where status = 'closed' limit 1;
  perform public.close_trip(t_id);
  raise exception 'FAIL: re-closed a trip';
exception when sqlstate '55000' then
  raise notice 'PASS: close_trip refused a closed run';
end $$;

\echo '=== R6f. cash in hand = COD collected minus trip pay ==='
do $$
declare v_hand bigint;
begin
  -- 11 delivered COD parcels at 12,000 = 132,000 held, less 18,600 pay owed
  v_hand := public.rider_cod_in_hand('44444444-4444-4444-4444-444444444444');
  if v_hand <> 113400 then
    raise exception 'FAIL: cod_in_hand %, expected 113400 (132000 - 18600)', v_hand;
  end if;
  raise notice 'PASS: 132000 collected - 18600 trip pay = 113400 in hand';
end $$;


-- ============================================================================
--  R7. SETTLEMENT — trip pay must reach the rider
-- ============================================================================

\echo '=== R7a. build_settlement counts trip_pay as rider earnings ==='
do $$
declare s public.settlements;
begin
  s := public.build_settlement('44444444-4444-4444-4444-444444444444');
  if s.gross_cod <> 132000 then
    raise exception 'FAIL: gross_cod %, expected 132000', s.gross_cod;
  end if;
  -- THE REGRESSION THIS TEST EXISTS FOR: before 0008 §8a this was 0, because
  -- rider_earnings summed only 'commission_earned'.
  if s.rider_earnings <> 18600 then
    raise exception 'FAIL: rider_earnings %, expected 18600 of trip pay', s.rider_earnings;
  end if;
  if s.net_due_platform <> 113400 then
    raise exception 'FAIL: net_due_platform %, expected 113400', s.net_due_platform;
  end if;
  -- Fees are reachable through the trip, not only through per-order ledger
  -- lines: 11 delivered parcels at 3,500.
  if s.delivery_fees <> 38500 then
    raise exception 'FAIL: delivery_fees %, expected 38500', s.delivery_fees;
  end if;
  if s.platform_share <> 19900 then
    raise exception 'FAIL: platform_share %, expected 19900 (38500 - 18600)', s.platform_share;
  end if;
  raise notice 'PASS: settlement 132000 COD / 18600 earned / 38500 fees / 19900 platform';
end $$;

\echo '=== R7b. rider_earnings_summary shows trip pay, not zero ==='
do $$
declare j jsonb;
begin
  j := public.rider_earnings_summary('44444444-4444-4444-4444-444444444444');
  if (j ->> 'earned_today')::bigint <> 18600 then
    raise exception 'FAIL: earned_today %, expected 18600', j ->> 'earned_today';
  end if;
  if (j ->> 'trip_pay_today')::bigint <> 18600 then
    raise exception 'FAIL: trip_pay_today %', j ->> 'trip_pay_today';
  end if;
  if (j ->> 'delivered_today')::int <> 11 then
    raise exception 'FAIL: delivered_today %', j ->> 'delivered_today';
  end if;
  raise notice 'PASS: rider app sees 18600 earned today, all of it trip pay';
end $$;

\echo '=== R7c. cod_positions separates trip pay from commission ==='
do $$
declare r record;
begin
  select * into r from public.cod_positions()
   where rider_id = '44444444-4444-4444-4444-444444444444';
  if r.trip_pay <> 18600 then
    raise exception 'FAIL: cod_positions.trip_pay %, expected 18600', r.trip_pay;
  end if;
  if r.commission <> 0 then
    raise exception 'FAIL: cod_positions.commission %, expected 0', r.commission;
  end if;
  if r.cod_collected <> 132000 then
    raise exception 'FAIL: cod_positions.cod_collected %', r.cod_collected;
  end if;
  raise notice 'PASS: audit explorer shows 18600 trip pay and 0 commission';
end $$;

\echo '=== R7d. admin_overview reports trip pay and short runs ==='
do $$
declare j jsonb;
begin
  j := public.admin_overview();
  if (j ->> 'trip_pay_today')::bigint <> 18600 then
    raise exception 'FAIL: trip_pay_today %', j ->> 'trip_pay_today';
  end if;
  if (j ->> 'rider_earnings_today')::bigint <> 18600 then
    raise exception 'FAIL: rider_earnings_today %, expected 18600', j ->> 'rider_earnings_today';
  end if;
  if (j ->> 'trips_short_today')::int <> 1 then
    raise exception 'FAIL: trips_short_today %, expected 1', j ->> 'trips_short_today';
  end if;
  if (j ->> 'trips_today')::int < 2 then
    raise exception 'FAIL: trips_today %', j ->> 'trips_today';
  end if;
  raise notice 'PASS: dashboard shows 18600 trip pay and 1 short run today';
end $$;


-- ============================================================================
--  R8. RLS — a rider sees their own run and nobody else's
-- ============================================================================

\echo '=== R8a. rider2 cannot see rider1 trips ==='
select set_config('request.jwt.claims','{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}',false);
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.trips
   where rider_id = '44444444-4444-4444-4444-444444444444';
  if n <> 0 then raise exception 'FAIL: rider2 sees % of rider1 trips', n; end if;

  select count(*) into n from public.trips;
  if n = 0 then raise exception 'FAIL: rider2 cannot see their own trip'; end if;
  raise notice 'PASS: rider2 sees only their own run (% visible)', n;
end $$;

\echo '=== R8b. a rider cannot dispatch or close a run ==='
do $$
declare t_id uuid;
begin
  select id into t_id from public.trips limit 1;
  perform public.depart_trip(t_id, 'Rider deciding to leave whenever they like.');
  raise exception 'FAIL: a rider departed a run';
exception
  when insufficient_privilege then raise notice 'PASS: depart_trip refused a rider';
  when sqlstate '55000'       then raise notice 'PASS: depart_trip refused a rider (state guard)';
end $$;
do $$
declare t_id uuid;
begin
  select id into t_id from public.trips limit 1;
  perform public.close_trip(t_id);
  raise exception 'FAIL: a rider closed a run';
exception
  when insufficient_privilege then raise notice 'PASS: close_trip refused a rider';
  when sqlstate '55000'       then raise notice 'PASS: close_trip refused a rider (state guard)';
end $$;

\echo '=== R8c. a rider cannot rewrite the pay tiers ==='
do $$
begin
  update public.route_pay_tiers set base_pay = 999999 where route_id is null;
  if found then raise exception 'FAIL: a rider repriced the pay tiers'; end if;
  raise notice 'PASS: pay-tier write silently filtered by RLS';
exception when insufficient_privilege then
  raise notice 'PASS: pay-tier write refused';
end $$;

\echo '=== R8c2. a rider cannot reprice a delivery zone, but can read it ==='
--  A rider CAN read the rate card, deliberately: `zones_read_all` is
--  `using (true)` because a shop's own session has to resolve the fee to be
--  quoted, and narrowing it to shops would mean a role check on the hot path of
--  every booking. Reading a price nobody pays them is harmless. Writing it is
--  not -- the fee is what a merchant is invoiced.
do $$
declare n int;
begin
  select count(*) into n from public.delivery_zones;
  if n < 2 then raise exception 'FAIL: a rider cannot read the rate card (% rows)', n; end if;
  raise notice 'PASS: a rider can read the rate card (% zones)', n;

  begin
    update public.delivery_zones set fee = 99000 where code = 'ZONE_1';
    if found then raise exception 'FAIL: a rider repriced Zone 1'; end if;
    raise notice 'PASS: zone write silently filtered by RLS';
  exception when insufficient_privilege then
    raise notice 'PASS: zone write refused';
  end;

  begin
    insert into public.delivery_zones (code, name, fee) values ('ZONE_FREE', 'Free', 0);
    raise exception 'FAIL: a rider invented a free delivery zone';
  exception
    when insufficient_privilege then raise notice 'PASS: zone insert refused';
    when check_violation then raise notice 'PASS: zone insert refused';
  end;
end $$;
reset role;

\echo '=== R8d. a shop owner cannot see trips at all ==='
select set_config('request.jwt.claims','{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',false);
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.trips;
  if n <> 0 then raise exception 'FAIL: a shop owner sees % trips', n; end if;
  raise notice 'PASS: a shop owner sees no trips';
end $$;
reset role;
select set_config('request.jwt.claims','',false);

-- ----------------------------------------------------------------------------
--  0025 — one visit to the shop
--
--  Three parcels from ONE shop, which is the ten-parcel case in miniature: the
--  rider makes one stop at the counter, and recording it used to mean three
--  separate advance_order calls.
-- ----------------------------------------------------------------------------
do $$
declare
  v_route uuid;
  v_rider uuid;
  t_id    uuid;
  t2_id   uuid;
  ids     uuid[];
  n       int;
begin
  select id into v_route from public.routes where code = 'ROUTE_LOCAL';

  -- Any rider not already out: trips_rider_open_uk allows one open run each,
  -- and earlier blocks in this file leave runs behind.
  select r.id into v_rider
    from public.rider_profiles r
   where not exists (
     select 1 from public.trips t
      where t.rider_id = r.id and t.status in ('planned','loading','departed'))
   limit 1;
  if v_rider is null then
    raise notice 'SKIP: every rider is already out, cannot test collection';
    return;
  end if;

  insert into public.orders (
    shop_id, pickup_address, pickup_lat, pickup_lng, customer_name, customer_phone,
    dropoff_address, dropoff_area_id, dropoff_lat, dropoff_lng, parcel_desc,
    payment_method, cod_amount, delivery_fee, created_by)
  select 'aaaaaaaa-0000-0000-0000-000000000001',
    'No. 24, Thitsar Road, San Pya Ward, Thingangyun, Yangon', 16.8478, 96.1693,
    'Armful Customer ' || g, '+95978' || lpad(g::text, 7, '0'),
    'Stop ' || g || ', Thitsar Road, Thingangyun', null,
    16.8500, 96.1700, 'Parcel', 'prepaid', 0, 2500,
    '33333333-3333-3333-3333-333333333333'
  from generate_series(1, 3) g;

  select array_agg(o.id) into ids
    from public.orders o
   where o.customer_name like 'Armful Customer %';

  t_id := (public.plan_trip(v_route)).id;
  perform public.assign_trip_rider(t_id, v_rider);
  -- 0028: these came in on an earlier collection run. A delivery leg
  -- may only carry parcels the hub is already holding.
  update public.orders set picked_up_at = coalesce(picked_up_at, now())
   where id = any(ids);
  perform public.load_trip(t_id, ids, 'delivery');
  perform public.depart_trip(t_id, 'collection test, deliberately short');

  -- 1. ALL OR NOTHING, tested BEFORE the good case so "nothing moved" is
  --    observable. One bad id in the array must leave all three untouched: a
  --    partly-applied armful is the failure the rider cannot see, because they
  --    walk out of the shop believing they have ten.
  begin
    perform public.advance_orders(ids || '00000000-0000-0000-0000-0000000000ff'::uuid,
                                  'picked_up');
    raise exception 'FAIL: advance_orders accepted an unknown parcel';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    select count(*) into n from public.orders where id = any(ids) and status = 'assigned';
    if n <> 3 then
      raise exception 'FAIL: % of 3 parcels stayed put after a rollback, expected 3', n;
    end if;
    raise notice 'PASS: one bad parcel rolls the whole armful back';
  end;

  -- 2. THE ARMFUL. One call, three parcels, one transaction.
  n := public.advance_orders(ids, 'picked_up');
  if n <> 3 then raise exception 'FAIL: advance_orders reported %, expected 3', n; end if;
  select count(*) into n from public.orders where id = any(ids) and status = 'picked_up';
  if n <> 3 then raise exception 'FAIL: % of 3 parcels advanced', n; end if;
  raise notice 'PASS: three parcels collected in one call';

  -- 3. An empty array is refused, not silently reported as success.
  begin
    perform public.advance_orders(array[]::uuid[], 'picked_up');
    raise exception 'FAIL: advance_orders accepted an empty array';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: an empty armful is refused';
  end;

  -- 4. THE PHANTOM STOP. A pickup leg is complete at picked_up, but close_trip
  --    used to release only failures -- so it kept trip_id forever and came
  --    back as a stop on every later run.
  update public.orders set trip_leg = 'pickup' where id = ids[1];
  perform public.advance_order(ids[2], 'delivered', 16.85, 96.17,
                               ids[2]::text || '/p.webp', 'Received');
  perform public.advance_order(ids[3], 'delivered', 16.85, 96.17,
                               ids[3]::text || '/p.webp', 'Received');
  perform public.return_trip(t_id);
  perform public.close_trip(t_id);

  select count(*) into n from public.orders
   where id = ids[1] and trip_id is null and trip_leg is null;
  if n <> 1 then
    raise exception 'FAIL: a collected pickup leg is still attached to its trip';
  end if;
  raise notice 'PASS: a finished collection lets go of the run';

  -- ------------------------------------------------------------------------
  --  0027 -- THE BLACK HOLE. ids[1] now sits on the hub shelf: trip_id null,
  --  trip_leg null, status picked_up. Every dispatcher pool wants 'pending',
  --  'failed' or resolution = 'return', and load_trip's eligibility test was
  --  status in ('pending','failed'). So a parcel the company had physically
  --  collected matched nothing and could never be sent out again.
  -- ------------------------------------------------------------------------
  select count(*) into n from public.orders
   where id = ids[1] and status = 'picked_up' and trip_id is null and trip_leg is null;
  if n <> 1 then raise exception 'FAIL: fixture is not a hub-held parcel'; end if;

  t2_id := (public.plan_trip(v_route)).id;

  -- 1. A run with no rider must refuse it: the parcel keeps 'picked_up', and
  --    load_trip takes the RUN's rider, which would null it and break
  --    orders_assigned_needs_rider.
  begin
    -- 0028: these came in on an earlier collection run. A delivery leg
    -- may only carry parcels the hub is already holding.
    update public.orders set picked_up_at = coalesce(picked_up_at, now())
     where id = any(array[ids[1]]);
    perform public.load_trip(t2_id, array[ids[1]], 'delivery');
    raise exception 'FAIL: a held parcel loaded onto a run with no rider';
  exception when sqlstate '55000' then
    raise notice 'PASS: a run needs a rider before it can carry hub-held parcels';
  end;

  perform public.assign_trip_rider(t2_id, v_rider);

  -- 2. It must never be offered to another collection -- that sends a rider
  --    across Yangon to fetch what is already on our shelf.
  begin
    perform public.load_trip(t2_id, array[ids[1]], 'pickup');
    raise exception 'FAIL: a parcel already at the hub was collected twice';
  exception when sqlstate '55000' then
    raise notice 'PASS: a parcel at the hub is never collected twice';
  end;

  -- 3. THE FIX. It loads onto a delivery leg, keeps 'picked_up' (there is no
  --    picked_up -> assigned edge in the status machine) and takes the new
  --    run's rider.
  -- 0028: these came in on an earlier collection run. A delivery leg
  -- may only carry parcels the hub is already holding.
  update public.orders set picked_up_at = coalesce(picked_up_at, now())
   where id = any(array[ids[1]]);
  perform public.load_trip(t2_id, array[ids[1]], 'delivery');
  select count(*) into n
    from public.orders o join public.trips t on t.id = t2_id
   where o.id = ids[1]
     and o.trip_id = t2_id and o.trip_leg = 'delivery'
     and o.status = 'picked_up' and o.rider_id = t.rider_id;
  if n <> 1 then
    raise exception 'FAIL: a collected parcel could not be sent out for delivery';
  end if;
  raise notice 'PASS: a parcel collected from a shop can be delivered to the customer';

  perform public.cancel_trip(t2_id, 'test cleanup');
end $$;

-- ----------------------------------------------------------------------------
--  0028 — COLLECT FIRST, THEN DELIVER
-- ----------------------------------------------------------------------------
do $$
declare
  v_route uuid;
  v_rider uuid;
  t_id    uuid;
  oid     uuid;
  n       int;
begin
  select id into v_route from public.routes where code = 'ROUTE_LOCAL';
  select r.id into v_rider
    from public.rider_profiles r
   where not exists (select 1 from public.trips t
                      where t.rider_id = r.id and t.status in ('planned','loading','departed'))
   limit 1;
  if v_rider is null then
    raise notice 'SKIP: every rider is already out, cannot test the collection rule';
    return;
  end if;

  insert into public.orders (
    shop_id, pickup_address, pickup_lat, pickup_lng, customer_name, customer_phone,
    dropoff_address, dropoff_area_id, dropoff_lat, dropoff_lng, parcel_desc,
    payment_method, cod_amount, delivery_fee, created_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
    'No. 24, Thitsar Road, San Pya Ward, Thingangyun, Yangon', 16.8478, 96.1693,
    'Collect First Customer', '+959780000042',
    'Somewhere, Thingangyun', null, 16.8500, 16.8500 * 0 + 96.1700, 'Parcel',
    'prepaid', 0, 2500, '33333333-3333-3333-3333-333333333333')
  returning id into oid;

  t_id := (public.plan_trip(v_route)).id;
  perform public.assign_trip_rider(t_id, v_rider);

  -- 1. THE RULE. It is still on the shop's shelf, so it cannot be delivered.
  begin
    perform public.load_trip(t_id, array[oid], 'delivery');
    raise exception 'FAIL: an uncollected parcel was loaded for delivery';
  exception when sqlstate '55000' then
    raise notice 'PASS: a parcel still at its shop cannot go on a delivery run';
  end;

  -- 2. It CAN be collected.
  perform public.load_trip(t_id, array[oid], 'pickup');

  --    COLLECTIONS NOW COUNT TOWARD THE MINIMUM. Before 0028 the gate measured
  --    delivery legs alone, so a run of thirty collections read as empty and
  --    every collection departure needed a typed override.
  --
  --    0039 CHANGED HOW THIS IS PROVED, not what is proved. This used to depart
  --    the run, catch the refusal and grep sqlerrm for '1/' -- but a short run
  --    no longer refuses, so there is no message to read. The audit row carries
  --    the same fact more directly and without string matching: one COLLECTION
  --    must show up as pickups = 1 and a shortfall of 19, where the pre-0028
  --    behaviour would have said 0 and 20.
  perform public.depart_trip(t_id, 'Single collection, verification run.');

  declare v_audit jsonb;
  begin
    select after into v_audit from public.audit_log
     where action = 'trip.depart_below_minimum' and entity_id = t_id::text
     order by created_at desc limit 1;
    if v_audit is null then
      raise exception 'FAIL: a 1/20 run left no below-minimum audit row';
    end if;
    if (v_audit ->> 'pickups')::int <> 1 then
      raise exception 'FAIL: the volume gate still ignores collections — pickups %',
        v_audit ->> 'pickups';
    end if;
    if (v_audit ->> 'shortfall')::int <> 19 then
      raise exception 'FAIL: shortfall %, expected 19 — collections not counted',
        v_audit ->> 'shortfall';
    end if;
    raise notice 'PASS: collections count toward the minimum volume (1 pickup, 19 short)';
  end;

  perform public.advance_order(oid, 'picked_up');
  perform public.return_trip(t_id);
  perform public.close_trip(t_id);

  -- 3. picked_up_at SURVIVES A BOUNCE BACK TO 'pending'. This is the property
  --    the whole rule rests on, and the exact path close_trip takes for a
  --    failed delivery that has attempts left: picked_up -> failed -> pending.
  --    The pending branch used to wipe picked_up_at, which would have sent a
  --    rider back to the shop for a parcel sitting on our own shelf.
  update public.orders set status = 'failed', fail_reason = 'nobody home'
   where id = oid and status = 'picked_up';
  update public.orders set status = 'pending' where id = oid and status = 'failed';
  select count(*) into n from public.orders
   where id = oid and picked_up_at is not null;
  if n <> 1 then
    raise exception 'FAIL: picked_up_at was wiped, the parcel looks uncollected again';
  end if;
  raise notice 'PASS: a collection survives the parcel being unassigned';

  -- 4. And it is never collected twice, whatever its status says.
  t_id := (public.plan_trip(v_route)).id;
  perform public.assign_trip_rider(t_id, v_rider);
  begin
    perform public.load_trip(t_id, array[oid], 'pickup');
    raise exception 'FAIL: a parcel at the hub was sent for collection again';
  exception when sqlstate '55000' then
    raise notice 'PASS: a parcel the hub holds is never collected twice';
  end;

  perform public.load_trip(t_id, array[oid], 'delivery');
  raise notice 'PASS: and it goes out on a delivery run';
  perform public.cancel_trip(t_id, 'test cleanup');
end $$;

-- ----------------------------------------------------------------------------
--  REPORTING A SHOP THAT WAS SHORT
--
--  The rider's collection card reports parcels a shop did not hand over as
--  assigned -> failed with a reason, in one call. 0018 counts that separately
--  from a delivery failure, against max_collection_attempts, so a shop that is
--  never ready hits a ceiling the office works.
-- ----------------------------------------------------------------------------
do $$
declare
  v_route uuid;
  v_rider uuid;
  t_id    uuid;
  ids     uuid[];
  n       int;
begin
  select id into v_route from public.routes where code = 'ROUTE_LOCAL';
  select r.id into v_rider
    from public.rider_profiles r
   where not exists (select 1 from public.trips t
                      where t.rider_id = r.id and t.status in ('planned','loading','departed'))
   limit 1;
  if v_rider is null then
    raise notice 'SKIP: every rider is already out, cannot test the short report';
    return;
  end if;

  insert into public.orders (
    shop_id, pickup_address, pickup_lat, pickup_lng, customer_name, customer_phone,
    dropoff_address, dropoff_area_id, dropoff_lat, dropoff_lng, parcel_desc,
    payment_method, cod_amount, delivery_fee, created_by)
  select 'aaaaaaaa-0000-0000-0000-000000000001',
    'No. 24, Thitsar Road, San Pya Ward, Thingangyun, Yangon', 16.8478, 96.1693,
    'Short Customer ' || g, '+95978100000' || g,
    'Stop ' || g || ', Thingangyun', null, 16.8500, 96.1700, 'Parcel',
    'prepaid', 0, 2500, '33333333-3333-3333-3333-333333333333'
  from generate_series(1, 2) g;

  select array_agg(o.id) into ids
    from public.orders o where o.customer_name like 'Short Customer %';

  t_id := (public.plan_trip(v_route)).id;
  perform public.assign_trip_rider(t_id, v_rider);
  perform public.load_trip(t_id, ids, 'pickup');
  perform public.depart_trip(t_id, 'Short-report verification run.');

  -- 1. A bulk report with NO reason is refused by advance_order's own guard,
  --    which is why the server action requires one in its type rather than
  --    hoping.
  begin
    perform public.advance_orders(ids, 'failed');
    raise exception 'FAIL: parcels were failed with no reason given';
  exception when sqlstate '55000' then
    raise notice 'PASS: a short report needs a reason';
  end;

  -- 2. With a reason, the whole armful moves and the reason is kept per parcel.
  n := public.advance_orders(ids, 'failed', 'shop shut');
  if n <> 2 then raise exception 'FAIL: reported % of 2', n; end if;
  select count(*) into n from public.orders
   where id = any(ids) and status = 'failed' and fail_reason = 'shop shut';
  if n <> 2 then raise exception 'FAIL: the reason did not reach both parcels'; end if;
  raise notice 'PASS: a short shop is reported for every parcel, with the reason';

  -- 3. AND IT COUNTS AS UNCOLLECTED, not as a failed delivery. This is the
  --    whole point: it is the collection ceiling that should move.
  if public.order_uncollected_count(ids[1]) <> 1 then
    raise exception 'FAIL: the report did not count as an uncollected attempt';
  end if;
  if public.order_attempt_count(ids[1]) <> 0 then
    raise exception 'FAIL: it was counted against the DELIVERY ceiling instead';
  end if;
  raise notice 'PASS: and it counts against the collection ceiling, not delivery';

  perform public.cancel_trip(t_id, 'test cleanup');
end $$;

-- ----------------------------------------------------------------------------
--  0029 — A COLLECTION CANNOT BE DELIVERED
--
--  The rider screen used to offer "DONE - DELIVERED" on a pickup leg, and
--  nothing refused the tap: it stamped cod_status = 'collected' and booked the
--  COD as cash the rider held, for a parcel on our own shelf.
-- ----------------------------------------------------------------------------
do $$
declare
  v_route uuid;
  v_rider uuid;
  t_id    uuid;
  oid     uuid;
  n       int;
begin
  select id into v_route from public.routes where code = 'ROUTE_LOCAL';
  select r.id into v_rider
    from public.rider_profiles r
   where not exists (select 1 from public.trips t
                      where t.rider_id = r.id and t.status in ('planned','loading','departed'))
   limit 1;
  if v_rider is null then
    raise notice 'SKIP: every rider is already out, cannot test the collection guard';
    return;
  end if;

  insert into public.orders (
    shop_id, pickup_address, pickup_lat, pickup_lng, customer_name, customer_phone,
    dropoff_address, dropoff_area_id, dropoff_lat, dropoff_lng, parcel_desc,
    payment_method, cod_amount, delivery_fee, created_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
    'No. 24, Thitsar Road, San Pya Ward, Thingangyun, Yangon', 16.8478, 96.1693,
    'Guard Customer', '+959780000043', 'Somewhere, Thingangyun', null,
    16.8500, 96.1700, 'Parcel', 'cod', 24500, 2500,
    '33333333-3333-3333-3333-333333333333')
  returning id into oid;

  t_id := (public.plan_trip(v_route)).id;
  perform public.assign_trip_rider(t_id, v_rider);
  perform public.load_trip(t_id, array[oid], 'pickup');
  perform public.depart_trip(t_id, 'Collection guard verification run.');
  perform public.advance_order(oid, 'picked_up');

  -- 1. THE MONEY BUG. Aboard, on a pickup leg, at the hub.
  begin
    perform public.advance_order(oid, 'delivered', 16.85, 96.17,
                                 oid::text || '/p.webp', 'Someone');
    raise exception 'FAIL: a parcel being collected was marked delivered';
  exception when sqlstate '55000' then
    raise notice 'PASS: a collection cannot be marked delivered';
  end;

  -- 2. And no COD was booked against the rider by the attempt.
  select count(*) into n from public.cod_ledger
   where order_id = oid and kind = 'cod_collected';
  if n <> 0 then
    raise exception 'FAIL: % COD line(s) booked for an undelivered parcel', n;
  end if;
  raise notice 'PASS: and no cash was booked against the rider';

  -- 3. A collection can still FAIL -- the shop was shut, the parcel was not
  --    ready. 0018 counts that separately as an uncollected attempt.
  perform public.advance_order(oid, 'failed', p_reason => 'shop shut');
  select count(*) into n from public.orders where id = oid and status = 'failed';
  if n <> 1 then raise exception 'FAIL: a collection could not be failed'; end if;
  raise notice 'PASS: a collection can still be reported failed';

  perform public.cancel_trip(t_id, 'test cleanup');
end $$;

\echo ''
\echo '####  ALL ROUTE / TRIP CHECKS PASSED  ####'
