-- ============================================================================
--  PHASE 5 — SETTLEMENT LIFECYCLE, REMITTANCE, ADMIN AGGREGATES
--  Run after rls_smoke.sql on a clean seeded DB.
-- ============================================================================
\set ON_ERROR_STOP on

\echo '=== S1. set up: rider1 delivers a COD order ==='
select set_config('request.jwt.claims','',false);
do $$
declare oid uuid; o public.orders;
begin
  update public.rider_profiles set is_online=true, availability='available',
         active_order_count=0, last_ping_at=now();
  select id into oid from public.orders
   where status='pending' and payment_method='cod' order by created_at limit 1;
  o := public.assign_order(oid, '44444444-4444-4444-4444-444444444444');
  o := public.advance_order(oid,'picked_up');
  o := public.advance_order(oid,'delivered',null,null, oid::text||'/p.webp','Daw Khin Myo');
  raise notice 'PASS: delivered cod=% commission=%', o.cod_amount, o.rider_commission_amount;
end $$;

\echo '=== S2. a dispatcher cannot remit cash or settle ==='
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',false);
set role authenticated;
do $$
begin
  perform public.remit_cod('44444444-4444-4444-4444-444444444444', 1000, 'nope');
  raise exception 'FAIL: dispatcher remitted cash';
exception when insufficient_privilege then raise notice 'PASS: remit_cod refused a dispatcher';
end $$;
do $$
begin
  perform public.build_settlement('44444444-4444-4444-4444-444444444444');
  raise exception 'FAIL: dispatcher built a settlement';
exception when insufficient_privilege then raise notice 'PASS: build_settlement refused a dispatcher';
end $$;
reset role;

\echo '=== S3. rider cannot remit their own cash ==='
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}',false);
set role authenticated;
do $$
begin
  perform public.remit_cod(auth.uid(), 500, 'self-serve');
  raise exception 'FAIL: rider wrote off their own cash';
exception when insufficient_privilege then raise notice 'PASS: rider cannot remit their own cash';
end $$;
reset role;

\echo '=== S4. interim remittance reduces cash in hand ==='
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',false);
set role authenticated;
do $$
declare before_amt bigint; after_amt bigint;
begin
  before_amt := public.rider_cod_in_hand('44444444-4444-4444-4444-444444444444');
  if before_amt <> 23000 then raise exception 'FAIL: expected 23000 in hand, got %', before_amt; end if;

  after_amt := public.remit_cod('44444444-4444-4444-4444-444444444444', 10000, 'Mid-shift deposit');
  if after_amt <> 13000 then raise exception 'FAIL: expected 13000 after deposit, got %', after_amt; end if;
  raise notice 'PASS: 23000 - 10000 = % in hand', after_amt;
end $$;

\echo '=== S5. cannot hand in more than you are holding ==='
do $$
begin
  perform public.remit_cod('44444444-4444-4444-4444-444444444444', 99999, 'too much');
  raise exception 'FAIL: over-deposit accepted';
exception when sqlstate '55000' then raise notice 'PASS: over-deposit refused';
end $$;
do $$
begin
  perform public.remit_cod('44444444-4444-4444-4444-444444444444', -500, 'negative');
  raise exception 'FAIL: negative deposit accepted';
exception when sqlstate '22023' then raise notice 'PASS: negative deposit refused';
end $$;

\echo '=== S6. build_settlement clears the balance and books the maths ==='
do $$
declare s public.settlements; in_hand bigint;
begin
  s := public.build_settlement('44444444-4444-4444-4444-444444444444', public.mm_today());

  if s.gross_cod <> 25000 then raise exception 'FAIL: gross_cod %', s.gross_cod; end if;
  if s.rider_earnings <> 2000 then raise exception 'FAIL: rider_earnings %', s.rider_earnings; end if;
  -- 25000 collected - 2000 commission - 10000 already handed in = 13000
  if s.net_due_platform <> 13000 then raise exception 'FAIL: net_due %', s.net_due_platform; end if;
  if s.status <> 'submitted' then raise exception 'FAIL: status %', s.status; end if;

  in_hand := public.rider_cod_in_hand('44444444-4444-4444-4444-444444444444');
  if in_hand <> 0 then raise exception 'FAIL: cash in hand is % after settling, expected 0', in_hand; end if;
  raise notice 'PASS: net due 13000, cash-in-hand cleared to 0';
end $$;

\echo '=== S7. approve -> paid, in order, once each ==='
do $$
declare sid uuid; s public.settlements;
begin
  select id into sid from public.settlements
   where rider_id='44444444-4444-4444-4444-444444444444' order by created_at desc limit 1;

  -- cannot pay before approving
  begin
    perform public.mark_settlement_paid(sid);
    raise exception 'FAIL: paid a settlement that was never approved';
  exception when sqlstate '55000' then raise notice 'PASS: cannot pay before approving';
  end;

  s := public.approve_settlement(sid);
  if s.status <> 'approved' or s.approved_by is null then raise exception 'FAIL: approve did not stick'; end if;

  begin
    perform public.approve_settlement(sid);
    raise exception 'FAIL: approved twice';
  exception when sqlstate '55000' then raise notice 'PASS: double approval refused';
  end;

  s := public.mark_settlement_paid(sid, 'Cash received at office');
  if s.status <> 'paid' or s.paid_at is null then raise exception 'FAIL: paid did not stick'; end if;
  raise notice 'PASS: submitted -> approved -> paid';
end $$;

\echo '=== S8. a paid settlement is terminal ==='
do $$
declare sid uuid;
begin
  select id into sid from public.settlements
   where rider_id='44444444-4444-4444-4444-444444444444' order by created_at desc limit 1;
  begin
    perform public.reopen_settlement(sid, 'changed my mind');
    raise exception 'FAIL: reopened a PAID settlement';
  exception when sqlstate '55000' then raise notice 'PASS: paid settlement cannot be reopened';
  end;
  begin
    perform public.build_settlement('44444444-4444-4444-4444-444444444444', public.mm_today());
    raise exception 'FAIL: rebuilt a paid settlement';
  exception when sqlstate '55000' then raise notice 'PASS: paid settlement cannot be rebuilt';
  end;
end $$;

\echo '=== S9. reopen requires a reason, and only from approved ==='
do $$
declare s public.settlements; sid uuid;
begin
  s := public.build_settlement('55555555-5555-5555-5555-555555555555', public.mm_today());
  sid := s.id;
  s := public.approve_settlement(sid);
  begin
    perform public.reopen_settlement(sid, '   ');
    raise exception 'FAIL: reopened with a blank reason';
  exception when sqlstate '22023' then raise notice 'PASS: reopen requires a reason';
  end;
  s := public.reopen_settlement(sid, 'Miscounted the cash');
  if s.status <> 'submitted' or s.approved_at is not null then
    raise exception 'FAIL: reopen left stale approval data';
  end if;
  raise notice 'PASS: reopened to submitted, approval cleared';
end $$;

\echo '=== S10. build_settlements_for_day sweeps the fleet, skips locked ==='
do $$
declare n int;
begin
  -- give rider2 something unsettled
  update public.rider_profiles set is_online=true, availability='available', active_order_count=0, last_ping_at=now();
  declare oid uuid; o public.orders;
  begin
    -- Area-bound and route-priced, like anything createOrder() would make.
    -- It carried a hardcoded 1,600 distance-era fee and no area at all, which is
    -- a parcel the app cannot produce and dispatch could never route.
    insert into public.orders (shop_id,pickup_address,pickup_lat,pickup_lng,customer_name,customer_phone,
      dropoff_address,dropoff_area_id,dropoff_lat,dropoff_lng,parcel_desc,payment_method,
      cod_amount,delivery_fee,route_id,created_by)
    select s.id,s.pickup_address,s.pickup_lat,s.pickup_lng,'Fleet Sweep','+959791110022',
      'Baho St, Lhay Htaung Kan',a.id,16.8402,96.1808,'sweep parcel','cod',
      5400 + r.per_parcel_fee, r.per_parcel_fee, r.id, s.owner_id
    from public.shops s
    join public.service_areas a on a.name = 'Lhay Htaung Kan'
    join public.route_areas ra on ra.area_id = a.id and ra.is_primary
    join public.routes r on r.id = ra.route_id
    where s.id='aaaaaaaa-0000-0000-0000-000000000001' returning id into oid;
    o := public.assign_order(oid,'66666666-6666-6666-6666-666666666666');
    o := public.advance_order(oid,'picked_up');
    o := public.advance_order(oid,'delivered',null,null,oid::text||'/p.webp','X');
  end;

  select count(*) into n from public.build_settlements_for_day(public.mm_today());
  if n < 1 then raise exception 'FAIL: swept % settlements', n; end if;
  raise notice 'PASS: drafted % settlement(s) without choking on the paid one', n;
end $$;

\echo '=== S11. cod_positions reconciles to the ledger ==='
do $$
declare r record; total_open bigint; ledger_open bigint;
begin
  select coalesce(sum(open_balance),0) into total_open from public.cod_positions();
  select coalesce(sum(amount),0) into ledger_open from public.cod_ledger where settlement_id is null;
  if total_open <> ledger_open then
    raise exception 'FAIL: cod_positions open % <> ledger open %', total_open, ledger_open;
  end if;

  select * into r from public.cod_positions()
   where rider_id='44444444-4444-4444-4444-444444444444';
  if r.cod_collected <> 25000 then raise exception 'FAIL: collected %', r.cod_collected; end if;
  if r.cod_remitted <> 10000 then raise exception 'FAIL: remitted %', r.cod_remitted; end if;
  if r.commission <> 2000 then raise exception 'FAIL: commission %', r.commission; end if;
  if r.open_balance <> 0 then raise exception 'FAIL: open_balance %', r.open_balance; end if;
  raise notice 'PASS: positions reconcile — collected 25000, remitted 10000, commission 2000, open 0';
end $$;

\echo '=== S12. cod_by_shop splits goods value from platform fees ==='
do $$
declare r record;
begin
  select * into r from public.cod_by_shop() where shop_id='aaaaaaaa-0000-0000-0000-000000000001';
  if r.cod_collected <> r.goods_value + r.platform_fees then
    raise exception 'FAIL: % <> % + %', r.cod_collected, r.goods_value, r.platform_fees;
  end if;
  raise notice 'PASS: shop cod % = goods % + fees %', r.cod_collected, r.goods_value, r.platform_fees;
end $$;

\echo '=== S13. admin_overview is dispatch-gated and internally consistent ==='
do $$
declare j jsonb;
begin
  j := public.admin_overview();
  if (j->>'riders_total')::int <> 3 then raise exception 'FAIL: riders_total %', j->>'riders_total'; end if;
  if (j->>'cod_outstanding')::bigint <>
     (select coalesce(sum(amount),0) from public.cod_ledger where settlement_id is null) then
    raise exception 'FAIL: cod_outstanding does not match the ledger';
  end if;
  raise notice 'PASS: overview riders=% online=% cod_outstanding=%',
    j->>'riders_total', j->>'riders_online', j->>'cod_outstanding';
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',false);
set role authenticated;
do $$
begin
  perform public.admin_overview();
  raise exception 'FAIL: a shop read the admin overview';
exception when insufficient_privilege then raise notice 'PASS: admin_overview refused a shop';
end $$;

\echo '=== S14. a shop sees no other shop in cod_by_shop (RLS, invoker) ==='
do $$
declare n int;
begin
  select count(*) into n from public.cod_by_shop();
  if n <> 1 then raise exception 'FAIL: shop sees % shops in cod_by_shop', n; end if;
  raise notice 'PASS: cod_by_shop is RLS-scoped — shop sees only itself';
end $$;
reset role;

\echo '=== S9. the customer paid the product; the rider collects the fee alone ==='
--  THE OFFICE, EXPLICITLY. `reset role` above restores the Postgres role but
--  NOT `request.jwt.claims`, which the block before this one set to the shop
--  owner -- so `assign_order` raised `forbidden` until this line existed.
--  Session state outlives the role.
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',false);
--  A customer often pays the shop for the PRODUCT and leaves the delivery fee
--  to be collected at the door. The booking form could not express it -- one
--  checkbox collapsed "paid for the product" and "paid for everything" into
--  "collect nothing" -- and the fix needed no migration, because the shape was
--  already legal:
--
--      payment_method = 'cod'
--      fee_payer      = 'customer'
--      cod_amount     = delivery_fee          (goods 0)
--
--  This asserts the MONEY, which was read off cod_by_shop rather than observed.
--  The rider hands in the fee, we keep all of it, and the shop is owed nothing
--  -- and the parts still sum to the collection, which this whole page depends
--  on: a money page whose parts do not sum to its total is one nobody believes.
do $$
declare oid uuid; fee bigint := 4000; r record;
begin
  insert into public.orders (shop_id, pickup_address, pickup_lat, pickup_lng,
    customer_name, customer_phone, dropoff_address, dropoff_area_id,
    dropoff_lat, dropoff_lng, parcel_desc, payment_method, cod_amount,
    delivery_fee, fee_payer, created_by)
  select s.id, s.pickup_address, s.pickup_lat, s.pickup_lng, 'Fee Only Customer',
    '+959791110093', 'Waizayanta Road, South Okkalapa',
    (select id from public.service_areas where name = 'South Okkalapa'),
    16.8300, 96.1950, 'product already paid', 'cod', fee, fee, 'customer',
    s.owner_id
  from public.shops s where s.id = 'aaaaaaaa-0000-0000-0000-000000000001'
  returning id into oid;
  raise notice 'PASS: a fee-only COD parcel is accepted (cod_amount = the fee)';

  perform public.assign_order(oid, '44444444-4444-4444-4444-444444444444');
  perform public.advance_order(oid, 'picked_up', 16.8478, 96.1693);
  perform public.advance_order(oid, 'delivered', 16.8300, 96.1950,
                               oid::text || '/p.webp', 'The customer');

  select * into r from public.cod_by_shop() where shop_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  -- The rider took the fee and nothing else.
  if r.cod_collected < fee then
    raise exception 'FAIL: cod_collected % did not include the fee-only parcel', r.cod_collected;
  end if;
  raise notice 'PASS: the fee reaches cod_collected';

  -- THE PART THAT MATTERS TO THE SHOP: it is owed nothing for this parcel. The
  -- customer paid it directly for the product, so there is nothing to pass on.
  -- Asserted as a DELTA against a second identical parcel, so the figure does
  -- not depend on whatever the rest of this suite booked.
  declare
    owed_before bigint := r.owed_to_shop;
    fees_before bigint := r.platform_fees;
    oid2 uuid;
  begin
    insert into public.orders (shop_id, pickup_address, pickup_lat, pickup_lng,
      customer_name, customer_phone, dropoff_address, dropoff_area_id,
      dropoff_lat, dropoff_lng, parcel_desc, payment_method, cod_amount,
      delivery_fee, fee_payer, created_by)
    select s.id, s.pickup_address, s.pickup_lat, s.pickup_lng, 'Fee Only Two',
      '+959791110094', 'Waizayanta Road, South Okkalapa',
      (select id from public.service_areas where name = 'South Okkalapa'),
      16.8300, 96.1950, 'product already paid 2', 'cod', fee, fee, 'customer',
      s.owner_id
    from public.shops s where s.id = 'aaaaaaaa-0000-0000-0000-000000000001'
    returning id into oid2;

    perform public.assign_order(oid2, '44444444-4444-4444-4444-444444444444');
    perform public.advance_order(oid2, 'picked_up', 16.8478, 96.1693);
    perform public.advance_order(oid2, 'delivered', 16.8300, 96.1950,
                                 oid2::text || '/p.webp', 'The customer');

    select * into r from public.cod_by_shop()
     where shop_id = 'aaaaaaaa-0000-0000-0000-000000000001';

    if r.owed_to_shop <> owed_before then
      raise exception 'FAIL: a fee-only parcel changed owed_to_shop by %',
        r.owed_to_shop - owed_before;
    end if;
    raise notice 'PASS: the shop is owed nothing more for a fee-only parcel';

    if r.platform_fees <> fees_before + fee then
      raise exception 'FAIL: platform_fees moved by %, expected %',
        r.platform_fees - fees_before, fee;
    end if;
    raise notice 'PASS: the whole collection is booked as our fee';
  end;

  -- And the page still adds up: collected = goods + fees.
  if r.cod_collected <> r.goods_value + r.platform_fees then
    raise exception 'FAIL: % collected <> % goods + % fees',
      r.cod_collected, r.goods_value, r.platform_fees;
  end if;
  raise notice 'PASS: collected = goods + fees still holds';
end $$;

\echo ''
\echo '####  ALL SETTLEMENT CHECKS PASSED  ####'
