-- ============================================================================
--  PHASE 1 EXIT-CRITERIA TEST
--
--  Every check RAISEs on failure, so a clean run means the invariants hold.
--  Run after 0001-0004 + seed. Requires the shim locally; on a real project run
--  it as the `postgres` role via the SQL editor.
-- ============================================================================

\set ON_ERROR_STOP on

\set ADMIN    '11111111-1111-1111-1111-111111111111'
\set DISPATCH '22222222-2222-2222-2222-222222222222'
\set SHOP     '33333333-3333-3333-3333-333333333333'
\set RIDER1   '44444444-4444-4444-4444-444444444444'
\set RIDER2   '55555555-5555-5555-5555-555555555555'
\set RIDER3   '66666666-6666-6666-6666-666666666666'

\echo '=== 0. structural: 16 tables, 9 enums, and RLS on every one ==='
do $$
declare t int; e int;
begin
  select count(*) into t from pg_tables where schemaname = 'public';
  select count(*) into e from pg_type ty join pg_namespace n on n.oid = ty.typnamespace
   where n.nspname = 'public' and ty.typtype = 'e';
  -- 0007 added routes, route_areas, route_pay_tiers, trips and the
  -- trip_status enum; 0016 removed notification_outbox again and 0017 added
  -- order_notes. A bare count is a blunt instrument, but it is the one assertion
  -- that notices a table shipped without RLS being considered at all.
  if t <> 17 then raise exception 'FAIL: expected 17 public tables, found %', t; end if;
  if e <> 9  then raise exception 'FAIL: expected 9 enums, found %', e; end if;

  -- And the count is only useful because of this: a new table with RLS left off
  -- is readable by every logged-in user of every role.
  if exists (select 1 from pg_tables
              where schemaname = 'public' and not rowsecurity) then
    raise exception 'FAIL: RLS is off on %',
      (select string_agg(tablename, ', ') from pg_tables
        where schemaname = 'public' and not rowsecurity);
  end if;
  raise notice 'PASS: % tables, % enums, RLS on all of them', t, e;
end $$;

\echo '=== 1. every public table has RLS enabled ==='
do $$
declare bad text;
begin
  select string_agg(tablename, ', ') into bad
    from pg_tables where schemaname = 'public' and not rowsecurity;
  if bad is not null then raise exception 'FAIL: RLS off on %', bad; end if;
  raise notice 'PASS: RLS enabled on every public table';
end $$;

\echo '=== 2. append-only tables have no UPDATE/DELETE policy ==='
do $$
declare bad text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public'
     and tablename in ('order_status_events','cod_ledger','audit_log',
                       -- order_assignments joined the list in 0009: with offers
                       -- retired, a rider has nothing left to respond to.
                       'order_assignments')
     and cmd in ('UPDATE','DELETE');
  if bad is not null then raise exception 'FAIL: mutating policy exists: %', bad; end if;
  raise notice 'PASS: status events, ledger, audit log and assignment history are immutable';
end $$;

\echo '=== 3. geofence rejects an out-of-township pin ==='
do $$
begin
  insert into public.orders (shop_id, pickup_address, pickup_lat, pickup_lng,
    customer_name, customer_phone, dropoff_address, dropoff_lat, dropoff_lng,
    parcel_desc, payment_method, cod_amount, delivery_fee, created_by)
  select id, pickup_address, pickup_lat, pickup_lng,
    'Out Of Area', '+959790000000', 'Mandalay somewhere', 21.9750, 96.0836,
    'test', 'prepaid', 0, 2000, owner_id
  from public.shops limit 1;
  raise exception 'FAIL: out-of-township dropoff was accepted';
exception
  when check_violation then raise notice 'PASS: geofence rejected Mandalay coordinates';
end $$;

\echo '=== 4. shop isolation: shop B cannot see shop A''s orders ==='
-- second shop under a second owner
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new,
        email_change_token_current, email_change, phone_change, phone_change_token, reauthentication_token)
values ('00000000-0000-0000-0000-000000000000','77777777-7777-7777-7777-777777777777',
        'authenticated','authenticated','shop2@mingalar.test',
        '{"role":"shop_owner"}'::jsonb, '{"full_name":"Rival Store","phone":"+959770000009"}'::jsonb,
        now(), now(), '', '', '', '', '', '', '', '')
on conflict (id) do nothing;
update public.profiles set phone = '+959770000009' where id = '77777777-7777-7777-7777-777777777777' and phone is null;
insert into public.shops (id, owner_id, name, phone, pickup_address, pickup_lat, pickup_lng)
values ('aaaaaaaa-0000-0000-0000-000000000002','77777777-7777-7777-7777-777777777777',
        'Rival Store','+959770000009','Thu Mingalar Rd, Thingangyun', 16.8555, 96.1750)
on conflict (id) do nothing;

select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}', false);
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.orders;
  if n <> 0 then raise exception 'FAIL: rival shop sees % orders it does not own', n; end if;
  raise notice 'PASS: rival shop sees 0 orders';
end $$;
do $$
declare n int;
begin
  select count(*) into n from public.rider_profiles;
  if n <> 0 then raise exception 'FAIL: shop can read % rider profiles', n; end if;
  raise notice 'PASS: shop cannot read rider_profiles';
end $$;
reset role;

\echo '=== 5. shop A sees exactly its own 2 seeded orders ==='
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.orders;
  if n <> 2 then raise exception 'FAIL: owning shop sees % orders, expected 2', n; end if;
  raise notice 'PASS: owning shop sees its 2 orders';
end $$;
reset role;

\echo '=== 6. rider cannot escalate their own role ==='
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
set role authenticated;
do $$
begin
  update public.profiles set role = 'super_admin' where id = auth.uid();
  raise exception 'FAIL: rider escalated to super_admin';
exception
  when insufficient_privilege then raise notice 'PASS: role escalation blocked (42501)';
end $$;

\echo '=== 7. rider cannot raise their own commission or capacity ==='
do $$
begin
  update public.rider_profiles set commission_pct_override = 100 where id = auth.uid();
  raise exception 'FAIL: rider set their own commission';
exception
  when insufficient_privilege then raise notice 'PASS: commission override blocked';
end $$;
do $$
begin
  update public.rider_profiles set coverage_km = 30 where id = auth.uid();
  raise exception 'FAIL: rider widened their own coverage radius';
exception
  when insufficient_privilege then raise notice 'PASS: coverage widening blocked';
end $$;
do $$
begin
  update public.rider_profiles set max_active_orders = 10 where id = auth.uid();
  raise exception 'FAIL: rider raised their own capacity';
exception
  when insufficient_privilege then raise notice 'PASS: capacity change blocked';
end $$;

\echo '=== 8. rider CAN toggle presence and narrow coverage ==='
do $$
begin
  perform public.rider_heartbeat(16.8451, 96.1706, true);
  update public.rider_profiles set coverage_km = 4.0 where id = auth.uid();
  raise notice 'PASS: heartbeat + coverage narrowing allowed';
end $$;

\echo '=== 9. rider sees no other rider, and no unassigned order ==='
do $$
declare nr int; no_ int;
begin
  select count(*) into nr from public.rider_profiles;
  select count(*) into no_ from public.orders;
  if nr <> 1 then raise exception 'FAIL: rider sees % rider rows, expected 1 (self)', nr; end if;
  if no_ <> 0 then raise exception 'FAIL: rider sees % unassigned orders, expected 0', no_; end if;
  raise notice 'PASS: rider sees only self, no unassigned work';
end $$;
reset role;

\echo '=== 10. the offer engine is retired (0009) ==='
do $$
declare gone text[] := array['offer_order','respond_to_offer','expire_stale_offers',
                             'nearby_available_riders','assign_order_internal'];
        found text;
begin
  select string_agg(p.proname, ', ') into found
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(gone);
  if found is not null then
    raise exception 'FAIL: offer-engine functions still present: %', found;
  end if;

  -- assign_order survives, and it must still be the ONLY writer of history.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'assign_order') then
    raise exception 'FAIL: assign_order was dropped with the offer engine';
  end if;
  if has_table_privilege('authenticated', 'public.order_assignments', 'INSERT') then
    raise exception 'FAIL: authenticated can still write assignment history';
  end if;
  raise notice 'PASS: 5 offer functions gone, assign_order kept, history read-only';
end $$;

\echo '=== 11. shop cannot assign a rider ==='
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
do $$
begin
  perform public.assign_order(
    (select id from public.orders order by created_at limit 1),
    '44444444-4444-4444-4444-444444444444');
  raise exception 'FAIL: shop assigned a rider';
exception
  when insufficient_privilege then raise notice 'PASS: assign_order refused a shop_owner';
end $$;
reset role;

\echo '=== 12. dispatcher assigns; commission snapshot is 80/20 ==='
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
set role authenticated;
do $$
declare o public.orders; oid uuid;
begin
  select id into oid from public.orders where status = 'pending' order by created_at limit 1;
  o := public.assign_order(oid, '44444444-4444-4444-4444-444444444444');

  if o.status <> 'assigned' then raise exception 'FAIL: status is %', o.status; end if;
  if o.rider_commission_pct <> 80.00 then raise exception 'FAIL: pct is %', o.rider_commission_pct; end if;
  if o.rider_commission_amount + o.platform_fee_amount <> o.delivery_fee then
    raise exception 'FAIL: split % + % <> fee %',
      o.rider_commission_amount, o.platform_fee_amount, o.delivery_fee;
  end if;
  if o.cod_status <> 'pending' then raise exception 'FAIL: cod_status is %', o.cod_status; end if;
  raise notice 'PASS: assigned. fee=% rider=% platform=% dist=%km',
    o.delivery_fee, o.rider_commission_amount, o.platform_fee_amount, o.assign_distance_km;
end $$;

\echo '=== 13. double-assignment loses ==='
do $$
begin
  perform public.assign_order(
    (select id from public.orders where status = 'assigned' order by assigned_at limit 1),
    '55555555-5555-5555-5555-555555555555');
  raise exception 'FAIL: second dispatcher also assigned the same order';
exception
  when sqlstate '55000' then raise notice 'PASS: second assign rejected (order_not_assignable)';
end $$;

\echo '=== 14. illegal transition pending -> delivered ==='
do $$
begin
  update public.orders set status = 'delivered', proof_photo_path = 'x/y.webp'
   where status = 'pending';
  raise exception 'FAIL: pending jumped straight to delivered';
exception
  when sqlstate '55000' then raise notice 'PASS: illegal transition blocked';
end $$;
reset role;

\echo '=== 15. rider lifecycle: picked_up -> delivered, proof enforced ==='
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
set role authenticated;
do $$
declare oid uuid; o public.orders;
begin
  select id into oid from public.orders where rider_id = auth.uid() and status = 'assigned' limit 1;

  o := public.advance_order(oid, 'picked_up', 16.8478, 96.1693);
  if o.status <> 'picked_up' or o.picked_up_at is null then
    raise exception 'FAIL: pickup not recorded';
  end if;

  begin
    o := public.advance_order(oid, 'delivered', 16.8402, 96.1808);
    raise exception 'FAIL: delivered accepted with no proof photo';
  exception
    when sqlstate '55000' then raise notice 'PASS: delivered without proof rejected';
  end;

  o := public.advance_order(oid, 'delivered', 16.8402, 96.1808,
        oid::text || '/proof-1.webp', 'Daw Khin Myo');
  if o.status <> 'delivered' or o.cod_status <> 'collected' then
    raise exception 'FAIL: delivery not finalised (status=%, cod=%)', o.status, o.cod_status;
  end if;
  raise notice 'PASS: full pending->assigned->picked_up->delivered cycle';
end $$;

\echo '=== 16. checkpoint trail is complete and rider cannot forge it ==='
do $$
declare n int;
begin
  select count(*) into n from public.order_status_events
   where order_id = (select id from public.orders where status = 'delivered' limit 1);
  -- insert(pending) + assigned + picked_up + delivered
  if n <> 4 then raise exception 'FAIL: expected 4 checkpoints, found %', n; end if;
  raise notice 'PASS: 4 checkpoints recorded';
end $$;
do $$
begin
  insert into public.order_status_events (order_id, to_status)
  values ((select id from public.orders where status = 'delivered' limit 1), 'cancelled');
  raise exception 'FAIL: rider forged a checkpoint row';
exception
  when insufficient_privilege then raise notice 'PASS: checkpoint trail is not client-writable';
end $$;

\echo '=== 17. capacity released, COD ledger booked with both legs ==='
do $$
declare v_active smallint; v_cod bigint; v_com bigint; v_hand bigint;
begin
  select active_order_count into v_active from public.rider_profiles where id = auth.uid();
  if v_active <> 0 then raise exception 'FAIL: active_order_count is % after delivery', v_active; end if;

  select sum(amount) filter (where kind = 'cod_collected'),
         sum(amount) filter (where kind = 'commission_earned')
    into v_cod, v_com
    from public.cod_ledger where rider_id = auth.uid();

  if v_cod <> 25000 then raise exception 'FAIL: cod leg is %, expected 25000', v_cod; end if;
  if v_com <> -2000 then raise exception 'FAIL: commission leg is %, expected -2000 (80%% of the 2500 route fee)', v_com; end if;

  select sum(amount) into v_hand from public.cod_ledger
   where rider_id = auth.uid() and settlement_id is null;
  if v_hand <> 23000 then raise exception 'FAIL: cash owed is %, expected 23000', v_hand; end if;
  raise notice 'PASS: ledger = +25000 cod, -2000 commission, 23000 due to platform';
end $$;
reset role;

\echo '=== 18. ledger is immutable even for super_admin (loud, not silent) ==='
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
set role authenticated;
do $$
begin
  update public.cod_ledger set amount = 0 where kind = 'cod_collected';
  raise exception 'FAIL: super_admin edited the ledger';
exception
  when insufficient_privilege then raise notice 'PASS: ledger UPDATE denied to super_admin';
end $$;
do $$
begin
  delete from public.cod_ledger where kind = 'cod_collected';
  raise exception 'FAIL: super_admin deleted a ledger line';
exception
  when insufficient_privilege then raise notice 'PASS: ledger DELETE denied to super_admin';
end $$;

\echo '=== 19. settlement math and idempotency ==='
do $$
declare s1 public.settlements; s2 public.settlements;
begin
  s1 := public.build_settlement('44444444-4444-4444-4444-444444444444', public.mm_today());

  if s1.gross_cod        <> 25000 then raise exception 'FAIL: gross_cod %', s1.gross_cod; end if;
  if s1.rider_earnings   <> 2000  then raise exception 'FAIL: rider_earnings %', s1.rider_earnings; end if;
  -- The ROUTE_LOCAL fee, and what is left of it after the 80/20 split.
  if s1.delivery_fees    <> 2500  then raise exception 'FAIL: delivery_fees %', s1.delivery_fees; end if;
  if s1.platform_share   <> 500   then raise exception 'FAIL: platform_share %', s1.platform_share; end if;
  if s1.net_due_platform <> s1.gross_cod - s1.rider_earnings then
    raise exception 'FAIL: net % <> % - %', s1.net_due_platform, s1.gross_cod, s1.rider_earnings;
  end if;
  if s1.order_count <> 1 then raise exception 'FAIL: order_count %', s1.order_count; end if;

  s2 := public.build_settlement('44444444-4444-4444-4444-444444444444', public.mm_today());
  if s2.id <> s1.id or s2.net_due_platform <> s1.net_due_platform or s2.order_count <> s1.order_count then
    raise exception 'FAIL: build_settlement is not idempotent';
  end if;
  raise notice 'PASS: settlement 25000 cod - 2000 rider = % due; idempotent', s1.net_due_platform;
end $$;

\echo '=== 20. a locked settlement refuses to be rebuilt ==='
do $$
begin
  update public.settlements set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where rider_id = '44444444-4444-4444-4444-444444444444';
  perform public.build_settlement('44444444-4444-4444-4444-444444444444', public.mm_today());
  raise exception 'FAIL: rebuilt an approved settlement';
exception
  when sqlstate '55000' then raise notice 'PASS: approved settlement is locked';
end $$;

\echo '=== 21. changing the split does not rewrite history (D5) ==='
do $$
declare before_amt bigint; after_amt bigint;
begin
  select rider_commission_amount into before_amt
    from public.orders where status = 'delivered' limit 1;
  update public.app_settings set rider_commission_pct = 70 where id;
  select rider_commission_amount into after_amt
    from public.orders where status = 'delivered' limit 1;
  if before_amt <> after_amt then
    raise exception 'FAIL: historical commission changed from % to %', before_amt, after_amt;
  end if;
  update public.app_settings set rider_commission_pct = 80 where id;
  raise notice 'PASS: snapshot survived a 80->70 split change';
end $$;

\echo '=== 22. anon can track by code but read no table ==='
reset role;
select set_config('request.jwt.claims', '', false);
set role anon;
do $$
declare j jsonb;
begin
  select public.track_order((select code from public.orders where status = 'delivered' limit 1)) into j;
  raise exception 'FAIL: anon read the orders table directly';
exception
  when insufficient_privilege then raise notice 'PASS: anon has no table grants';
end $$;
reset role;
do $$
declare v_code text; j jsonb;
begin
  select code into v_code from public.orders where status = 'delivered' limit 1;
  set local role anon;
  select public.track_order(v_code) into j;
  if j is null or j->>'status' <> 'delivered' then
    raise exception 'FAIL: track_order returned %', j;
  end if;
  if j ? 'customer_phone' or j ? 'dropoff_address' then
    raise exception 'FAIL: track_order leaked PII';
  end if;
  raise notice 'PASS: anon tracking works and leaks no PII: %', j->>'code';
end $$;

-- ============================================================================
--  THE CUSTOMER LOOKUP SURFACE
--
--  The booking form lets a shop search its own past parcels to reuse a
--  customer's name, phone, address and delivery point. That is the shop's own
--  data — but it is also the first screen that deliberately shows customer PII
--  in bulk, so the boundary gets its own assertion rather than relying on the
--  general orders policy being read correctly by whoever adds the next feature.
-- ============================================================================

\echo '=== customer lookup: a shop searches its OWN customers and nobody else''s ==='
do $$
declare
  v_mine int;
  v_other int;
  v_second uuid := 'aaaaaaaa-0000-0000-0000-00000000beef';
begin
  -- A second shop, owned by somebody else, with a parcel of its own.
  insert into public.shops (id, owner_id, name, phone, pickup_address, pickup_lat, pickup_lng)
  values (v_second, '11111111-1111-1111-1111-111111111111', 'Rival Store', '+959770009999',
          'No. 1, Other Road', 16.8478, 96.1693)
  on conflict (id) do nothing;

  insert into public.orders (
    shop_id, pickup_address, pickup_lat, pickup_lng, customer_name, customer_phone,
    dropoff_address, dropoff_area_id, dropoff_lat, dropoff_lng, parcel_desc,
    payment_method, cod_amount, delivery_fee, created_by)
  select v_second, 'No. 1, Other Road', 16.8478, 96.1693,
         'SECRET RIVAL CUSTOMER', '+959770008888',
         'Rival customer address', a.id, 16.7760, 96.1580, 'p', 'prepaid', 0, 3500,
         '11111111-1111-1111-1111-111111111111'
  from public.service_areas a where a.name = 'Kyauktada / Sule';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

  -- Exactly the columns and the shape the lookup component asks for, and
  -- deliberately WITHOUT a shop_id filter — the point is that the policy is
  -- what scopes it, not the query.
  select count(*) into v_mine
    from public.orders
   where customer_phone is not null;

  select count(*) into v_other
    from public.orders
   where customer_name = 'SECRET RIVAL CUSTOMER'
      or customer_phone = '+959770008888'
      or dropoff_address = 'Rival customer address';

  if v_other <> 0 then
    raise exception 'FAIL: a shop read % row(s) of another shop''s customers', v_other;
  end if;
  if v_mine = 0 then
    raise exception 'FAIL: the shop cannot see its own customers either';
  end if;
  raise notice 'PASS: shop sees its own % customer row(s), 0 of the rival''s', v_mine;

  reset role;
  perform set_config('request.jwt.claims','',false);

  delete from public.orders where shop_id = v_second;
  delete from public.shops where id = v_second;
end $$;

-- ----------------------------------------------------------------------------
--  policy_acceptances (0023) -- the record has to be forgery-proof and
--  edit-proof, because the whole reason it exists is to answer "did this shop
--  agree to clause 6" after a parcel turned out to hold a rock.
-- ----------------------------------------------------------------------------
do $$
declare
  v_shop uuid := '33333333-3333-3333-3333-333333333333';
  v_rival uuid := '77777777-7777-7777-7777-777777777777';
  n int;
begin
  -- Two acceptances on file, one per person, written as the service role.
  insert into public.policy_acceptances (profile_id, policy_key, version)
  values (v_shop, 'cod_advance', '2026-09-05'), (v_rival, 'cod_advance', '2026-09-05')
  on conflict do nothing;

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_shop), false);
  execute 'set role authenticated';

  -- 1. own row, and only own
  select count(*) into n from public.policy_acceptances;
  if n <> 1 then
    raise exception 'FAIL: shop sees % acceptance rows, expected only its own', n;
  end if;
  select count(*) into n from public.policy_acceptances where profile_id = v_rival;
  if n <> 0 then raise exception 'FAIL: shop can read the rival''s acceptance'; end if;
  raise notice 'PASS: a shop reads its own acceptance and none of the rival''s';

  -- 2. cannot sign in somebody else's name
  begin
    insert into public.policy_acceptances (profile_id, policy_key, version)
    values (v_rival, 'cod_advance', 'forged');
    raise exception 'FAIL: a shop filed an acceptance under another profile_id';
  exception when insufficient_privilege then
    raise notice 'PASS: an acceptance cannot be filed in someone else''s name';
  end;

  -- 3. APPEND-ONLY. No update policy and no delete policy exist, so neither is
  --    permitted for anyone -- including the person who wrote the row.
  update public.policy_acceptances set version = 'tampered' where profile_id = v_shop;
  if found then raise exception 'FAIL: an acceptance was edited'; end if;
  delete from public.policy_acceptances where profile_id = v_shop;
  if found then raise exception 'FAIL: an acceptance was deleted'; end if;
  select count(*) into n from public.policy_acceptances where profile_id = v_shop;
  if n <> 1 then raise exception 'FAIL: the shop''s own acceptance did not survive'; end if;
  raise notice 'PASS: an acceptance cannot be edited or deleted, by anyone';

  -- 4. the office can read every row, which is who needs it in a dispute
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
  select count(*) into n from public.policy_acceptances;
  if n < 2 then raise exception 'FAIL: dispatch sees % acceptance rows, expected all', n; end if;
  raise notice 'PASS: dispatch reads every acceptance';

  reset role;
  perform set_config('request.jwt.claims','',false);
  delete from public.policy_acceptances;
end $$;

-- ----------------------------------------------------------------------------
--  public_settings() (0024) -- the support number has to reach people who
--  cannot sign in, without app_settings itself reaching them.
-- ----------------------------------------------------------------------------
do $$
declare
  v jsonb;
  n int;
begin
  perform set_config('request.jwt.claims','',false);
  execute 'set role anon';

  -- 1. anon may call it, and gets the two public fields
  v := public.public_settings();
  if v is null then raise exception 'FAIL: anon got nothing from public_settings()'; end if;
  if not (v ? 'support_phone' and v ? 'brand_name') then
    raise exception 'FAIL: public_settings() is missing a public field: %', v;
  end if;
  -- and nothing else: a widened function is the failure this guards against
  select count(*) into n from jsonb_object_keys(v);
  if n <> 2 then
    raise exception 'FAIL: public_settings() exposes % fields, expected 2: %', n, v;
  end if;
  raise notice 'PASS: anon reads the support number, and only that';

  -- 2. THE WALL IS STILL THERE. The function widened the door; if the table
  --    itself became readable, anon would also have pricing, commission, the
  --    geofence and the KPay account.
  begin
    perform 1 from public.app_settings;
    raise exception 'FAIL: anon can read app_settings directly';
  exception when insufficient_privilege then
    raise notice 'PASS: anon still cannot read app_settings itself';
  end;

  reset role;
end $$;

-- ----------------------------------------------------------------------------
--  shops_guard (0026) -- a shop owns its description, not the decision about
--  itself. Before this trigger existed a suspended shop could run one UPDATE
--  and un-suspend itself; that is what assertion 1 reproduces.
-- ----------------------------------------------------------------------------
do $$
declare
  v_shop  uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_owner uuid := '33333333-3333-3333-3333-333333333333';
  n int;
begin
  -- A shop that predates approval keeps trading. Checked on the seeded shop
  -- rather than "no shop anywhere is unapproved", because the fixtures in this
  -- file create rival shops on purpose and those SHOULD arrive unapproved.
  select count(*) into n from public.shops where id = v_shop and approved_at is not null;
  if n <> 1 then
    raise exception 'FAIL: an established shop was left unapproved and cannot trade';
  end if;
  raise notice 'PASS: an established shop keeps trading after 0026';

  update public.shops set is_active = false where id = v_shop;

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_owner), false);
  execute 'set role authenticated';

  -- 1. THE LIVE BUG. One UPDATE used to be enough.
  begin
    update public.shops set is_active = true where id = v_shop;
    raise exception 'FAIL: a suspended shop un-suspended itself';
  exception when insufficient_privilege then
    raise notice 'PASS: a suspended shop cannot un-suspend itself';
  end;

  -- 2. And it cannot wave itself through the office either.
  begin
    update public.shops set approved_at = now() where id = v_shop;
    raise exception 'FAIL: a shop approved itself';
  exception when insufficient_privilege then
    raise notice 'PASS: a shop cannot approve itself';
  end;
  -- Genuinely different values: the guard compares old to new, so setting a
  -- field to what it already holds is not a change and is rightly allowed.
  begin
    update public.shops set rejected_at = now() where id = v_shop;
    raise exception 'FAIL: a shop rejected itself';
  exception when insufficient_privilege then
    raise notice 'PASS: a shop cannot write its own rejection';
  end;
  begin
    update public.shops set owner_id = '22222222-2222-2222-2222-222222222222'
     where id = v_shop;
    raise exception 'FAIL: a shop handed itself to another owner';
  exception when insufficient_privilege then
    raise notice 'PASS: a shop cannot change its own owner';
  end;

  -- 3. INSERT is guarded too: the setup step inserts under the OWNER's session,
  --    so without this a shop could simply arrive pre-approved.
  insert into public.shops (owner_id, name, phone, pickup_address, pickup_lat, pickup_lng,
                            goods_type, approved_at, is_active)
  values (v_owner, 'Self Approved Shop', '+959770001234',
          'No. 1, Thitsar Road, Thingangyun', 16.8478, 96.1693,
          'Anything', now(), true);
  select count(*) into n from public.shops
   where name = 'Self Approved Shop' and approved_at is null;
  if n <> 1 then
    raise exception 'FAIL: a shop inserted itself pre-approved';
  end if;
  raise notice 'PASS: a shop arrives unapproved however it asks';

  -- 4. But it still owns its own description -- shop settings must keep working.
  update public.shops
     set name = 'Renamed By Owner', goods_type = 'Phone accessories',
         pickup_address = 'No. 9, Thitsar Road, Thingangyun'
   where id = v_shop;
  select count(*) into n from public.shops
   where id = v_shop and name = 'Renamed By Owner' and goods_type = 'Phone accessories';
  if n <> 1 then raise exception 'FAIL: a shop cannot edit its own details'; end if;
  raise notice 'PASS: a shop still owns its own name, goods and address';

  -- 5. The office can do all of it, and it is written down. Impersonating the
  --    ADMIN, not resetting to the superuser: is_service_ctx() skips the guard
  --    entirely (as it does for profiles), so a superuser write audits nothing
  --    and would prove nothing about what an admin's click records.
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
  update public.shops set approved_at = now(), is_active = true where id = v_shop;
  select count(*) into n from public.audit_log where action = 'shop.decision';
  if n < 1 then raise exception 'FAIL: an approval left no audit row'; end if;
  raise notice 'PASS: the office decides, and the decision is on the audit log';

  reset role;
  perform set_config('request.jwt.claims','',false);
  delete from public.shops where name = 'Self Approved Shop';
  update public.shops set name = 'San Pya Mini Mart', goods_type = null,
         pickup_address = 'No. 24, Thitsar Road, San Pya Ward, Thingangyun, Yangon'
   where id = v_shop;
end $$;

\echo ''
\echo '######  ALL PHASE 1 CHECKS PASSED  ######'
