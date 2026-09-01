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
  if before_amt <> 22900 then raise exception 'FAIL: expected 22900 in hand, got %', before_amt; end if;

  after_amt := public.remit_cod('44444444-4444-4444-4444-444444444444', 10000, 'Mid-shift deposit');
  if after_amt <> 12900 then raise exception 'FAIL: expected 12900 after deposit, got %', after_amt; end if;
  raise notice 'PASS: 22900 - 10000 = % in hand', after_amt;
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

  if s.gross_cod <> 24500 then raise exception 'FAIL: gross_cod %', s.gross_cod; end if;
  if s.rider_earnings <> 1600 then raise exception 'FAIL: rider_earnings %', s.rider_earnings; end if;
  -- 24500 collected - 1600 commission - 10000 already handed in = 12900
  if s.net_due_platform <> 12900 then raise exception 'FAIL: net_due %', s.net_due_platform; end if;
  if s.status <> 'submitted' then raise exception 'FAIL: status %', s.status; end if;

  in_hand := public.rider_cod_in_hand('44444444-4444-4444-4444-444444444444');
  if in_hand <> 0 then raise exception 'FAIL: cash in hand is % after settling, expected 0', in_hand; end if;
  raise notice 'PASS: net due 12900, cash-in-hand cleared to 0';
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
    insert into public.orders (shop_id,pickup_address,pickup_lat,pickup_lng,customer_name,customer_phone,
      dropoff_address,dropoff_lat,dropoff_lng,parcel_desc,payment_method,cod_amount,delivery_fee,created_by)
    select s.id,s.pickup_address,s.pickup_lat,s.pickup_lng,'Fleet Sweep','+959791110022',
      'Baho St, Lhay Htaung Kan',16.8402,96.1808,'sweep parcel','cod',7000,1600,s.owner_id
    from public.shops s where s.id='aaaaaaaa-0000-0000-0000-000000000001' returning id into oid;
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
  if r.cod_collected <> 24500 then raise exception 'FAIL: collected %', r.cod_collected; end if;
  if r.cod_remitted <> 10000 then raise exception 'FAIL: remitted %', r.cod_remitted; end if;
  if r.commission <> 1600 then raise exception 'FAIL: commission %', r.commission; end if;
  if r.open_balance <> 0 then raise exception 'FAIL: open_balance %', r.open_balance; end if;
  raise notice 'PASS: positions reconcile — collected 24500, remitted 10000, commission 1600, open 0';
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

\echo ''
\echo '####  ALL SETTLEMENT CHECKS PASSED  ####'
