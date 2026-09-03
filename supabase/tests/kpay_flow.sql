-- ============================================================================
--  KPAY VERIFICATION  —  migrations 0020 + 0021
--
--  This suite is about ONE number: what the rider owes at the end of the shift.
--
--  tg_orders_audit books `cod_collected` to the RIDER on delivery, and
--  settlement demands it back in cash. A KPay transfer goes to the office
--  account, so the rider holds nothing — and every assertion here exists because
--  getting that wrong means asking a rider for 48,500 Ks they never touched.
--
--  Run on a clean seeded DB.
-- ============================================================================
\set ON_ERROR_STOP on

select set_config('request.jwt.claims','',false);   -- service context

\set RIDER1 '44444444-4444-4444-4444-444444444444'
\set DISPATCH '22222222-2222-2222-2222-222222222222'
\set SHOP '33333333-3333-3333-3333-333333333333'

create or replace function pg_temp.mk_cod(p_customer text, p_cod bigint default 48500)
returns uuid language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.orders (
    shop_id, pickup_address, pickup_lat, pickup_lng, customer_name, customer_phone,
    dropoff_address, dropoff_area_id, dropoff_lat, dropoff_lng, parcel_desc,
    payment_method, cod_amount, delivery_fee, created_by)
  select 'aaaaaaaa-0000-0000-0000-000000000001',
    'No. 24, Thitsar Road', 16.8478, 96.1693, p_customer, '+959790007777',
    'Sule Pagoda Road, Kyauktada', a.id, 16.7760, 96.1580, p_customer || ' parcel',
    'cod', p_cod, r.per_parcel_fee, '33333333-3333-3333-3333-333333333333'
  from public.service_areas a
  join public.route_areas ra on ra.area_id = a.id and ra.is_primary
  join public.routes r on r.id = ra.route_id
  where a.name = 'Kyauktada / Sule'
  returning id into v_id;
  return v_id;
end $fn$;

/** Deliver p_order by p_via, uploading the paths it demands. */
create or replace function pg_temp.deliver(p_order uuid, p_via text)
returns public.orders language plpgsql as $fn$
begin
  perform public.assign_order(p_order, '44444444-4444-4444-4444-444444444444');
  perform public.advance_order(p_order, 'picked_up');
  return public.advance_order(p_order, 'delivered', null, null,
    p_order || '/proof.jpg', 'Customer', null, p_via,
    case when p_via = 'kpay' then p_order || '/kpay.jpg' end);
end $fn$;


-- ============================================================================
--  K0. STRUCTURE
-- ============================================================================

\echo '=== K0. the columns, the constraints and the office account ==='
do $$
declare v_name text; v_phone text; v_qr text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'orders' and column_name = 'collected_via') then
    raise exception 'FAIL: orders.collected_via missing';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'cod_status' and e.enumlabel = 'kpay_pending') then
    raise exception 'FAIL: cod_status has no kpay_pending';
  end if;

  select kpay_account_name, kpay_phone, kpay_qr_url into v_name, v_phone, v_qr
    from public.app_settings where id;
  if v_name is null or v_phone is null or v_qr is null then
    raise exception 'FAIL: the office KPay account is not configured';
  end if;
  raise notice 'PASS: KPay account on file — % / %', v_name, v_phone;

  -- Only two ways to pay.
  begin
    update public.orders set collected_via = 'wave' where id = (select id from public.orders limit 1);
    raise exception 'FAIL: an unknown payment channel was accepted';
  exception when check_violation then
    raise notice 'PASS: collected_via is cash or kpay only';
  end;
end $$;


-- ============================================================================
--  K1. THE LEDGER — the assertion this whole suite exists for
-- ============================================================================

\echo '=== K1. a CASH delivery still books the rider''s debt ==='
do $$
declare oid uuid; o public.orders; v_cash bigint;
begin
  oid := pg_temp.mk_cod('Cash Customer');
  o := pg_temp.deliver(oid, 'cash');

  if o.cod_status <> 'collected' then
    raise exception 'FAIL: cash delivery left cod_status %', o.cod_status;
  end if;
  select coalesce(sum(amount), 0) into v_cash from public.cod_ledger
   where order_id = oid and kind = 'cod_collected';
  if v_cash <> 48500 then
    raise exception 'FAIL: cash line is %, expected 48500', v_cash;
  end if;
  raise notice 'PASS: cash — 48500 booked against the rider, cod_status collected';
end $$;

\echo '=== K1b. a KPAY delivery books NOTHING against the rider ==='
do $$
declare oid uuid; o public.orders; v_cash int; v_comm int; v_before bigint; v_after bigint;
begin
  select public.rider_cod_in_hand('44444444-4444-4444-4444-444444444444') into v_before;

  oid := pg_temp.mk_cod('KPay Customer');
  o := pg_temp.deliver(oid, 'kpay');

  if o.cod_status <> 'kpay_pending' then
    raise exception 'FAIL: cod_status %, expected kpay_pending', o.cod_status;
  end if;

  select count(*) filter (where kind = 'cod_collected'),
         count(*) filter (where kind = 'commission_earned')
    into v_cash, v_comm
    from public.cod_ledger where order_id = oid;

  -- THE ONE. A line here is a rider being asked for money they never held.
  if v_cash <> 0 then
    raise exception 'FAIL: % cash line(s) booked for a KPay payment', v_cash;
  end if;
  -- But they DID the delivery, so the commission is theirs.
  if v_comm <> 1 then
    raise exception 'FAIL: % commission line(s), expected 1', v_comm;
  end if;

  select public.rider_cod_in_hand('44444444-4444-4444-4444-444444444444') into v_after;
  if v_after >= v_before then
    raise exception 'FAIL: a KPay delivery increased the rider''s cash position (% -> %)',
      v_before, v_after;
  end if;
  raise notice 'PASS: kpay — 0 cash lines, 1 commission line, cash position % -> %',
    v_before, v_after;
end $$;


-- ============================================================================
--  K2. THE RIDER CANNOT SKIP THE EVIDENCE
-- ============================================================================

\echo '=== K2. a COD delivery must say how, and KPay must show the receipt ==='
do $$
declare oid uuid; o public.orders;
begin
  oid := pg_temp.mk_cod('No Method');
  perform public.assign_order(oid, '44444444-4444-4444-4444-444444444444');
  perform public.advance_order(oid, 'picked_up');

  -- An unstated channel means CASH, deliberately: a rider on last week's build
  -- must not find deliveries refused at the doorstep. See the note in 0021.
  o := public.advance_order(oid, 'delivered', null, null, oid || '/proof.jpg');
  if o.collected_via <> 'cash' then
    raise exception 'FAIL: an unstated channel became %, expected cash', o.collected_via;
  end if;
  if o.cod_status <> 'collected' then
    raise exception 'FAIL: the cash default did not book against the rider (%)', o.cod_status;
  end if;
  raise notice 'PASS: no channel stated -> cash, booked to the rider as before';

  oid := pg_temp.mk_cod('No Receipt');
  perform public.assign_order(oid, '44444444-4444-4444-4444-444444444444');
  perform public.advance_order(oid, 'picked_up');
  begin
    perform public.advance_order(oid, 'delivered', null, null, oid || '/proof.jpg',
                                 'Customer', null, 'kpay', null);
    raise exception 'FAIL: KPay accepted with no receipt';
  exception when object_not_in_prerequisite_state then
    if sqlerrm not like '%kpay_proof_required%' then raise; end if;
    raise notice 'PASS: KPay demands the receipt screenshot';
  end;
end $$;

\echo '=== K2b. and the constraint refuses it even by hand ==='
do $$
declare oid uuid;
begin
  oid := pg_temp.mk_cod('Hand Written');
  -- Reach `picked_up` legally first: the status machine refuses
  -- pending -> delivered before the CHECK ever gets a chance to fire, so an
  -- illegal jump would test the wrong guard.
  perform public.assign_order(oid, '44444444-4444-4444-4444-444444444444');
  perform public.advance_order(oid, 'picked_up');

  begin
    update public.orders
       set status = 'delivered', collected_via = 'kpay', kpay_proof_path = null,
           proof_photo_path = 'x/y.jpg'
     where id = oid;
    raise exception 'FAIL: orders_kpay_needs_receipt did not hold';
  exception when check_violation then
    raise notice 'PASS: orders_kpay_needs_receipt refuses a receiptless KPay delivery';
  end;
end $$;


-- ============================================================================
--  K3. CONFIRM AND REJECT
-- ============================================================================

\echo '=== K3. confirming closes the money out, once ==='
do $$
declare oid uuid; o public.orders; v_lines int;
begin
  oid := pg_temp.mk_cod('To Confirm');
  perform pg_temp.deliver(oid, 'kpay');

  o := public.confirm_kpay_payment(oid);
  if o.cod_status <> 'settled' then
    raise exception 'FAIL: cod_status % after confirm', o.cod_status;
  end if;
  if o.kpay_confirmed_at is null then raise exception 'FAIL: not stamped'; end if;

  -- Still no rider line. Confirming is the OFFICE receiving money.
  select count(*) into v_lines from public.cod_ledger
   where order_id = oid and kind = 'cod_collected';
  if v_lines <> 0 then
    raise exception 'FAIL: confirming booked % cash line(s) to the rider', v_lines;
  end if;

  -- And it appears in the parcel's own story.
  if not exists (select 1 from public.order_notes
                  where order_id = oid and body like '%confirmed%') then
    raise exception 'FAIL: the confirmation is not in the contact log';
  end if;

  begin
    perform public.confirm_kpay_payment(oid);
    raise exception 'FAIL: confirmed twice';
  exception when object_not_in_prerequisite_state then
    raise notice 'PASS: confirmed once, settled, logged, and not repeatable';
  end;
end $$;

\echo '=== K3b. rejecting keeps the parcel delivered and the money owed ==='
do $$
declare oid uuid; o public.orders;
begin
  oid := pg_temp.mk_cod('To Reject');
  perform pg_temp.deliver(oid, 'kpay');

  -- A rejection nobody can act on is not a rejection.
  begin
    perform public.reject_kpay_payment(oid, 'no');
    raise exception 'FAIL: rejected with no usable reason';
  exception when invalid_parameter_value then
    raise notice 'PASS: a rejection needs a reason';
  end;

  o := public.reject_kpay_payment(oid, 'Screenshot shows 4,850 not 48,500');

  -- THE DECISION: the customer has the goods, so the delivery stands.
  if o.status <> 'delivered' then
    raise exception 'FAIL: rejecting rewound the status to %', o.status;
  end if;
  -- But the money is outstanding and nobody is holding it.
  if o.cod_status <> 'pending' then
    raise exception 'FAIL: cod_status % after reject, expected pending', o.cod_status;
  end if;
  if o.kpay_reject_reason is null then raise exception 'FAIL: no reason kept'; end if;
  if o.kpay_confirmed_at is not null then raise exception 'FAIL: still looks confirmed'; end if;

  if not exists (select 1 from public.order_notes
                  where order_id = oid and body like '%REJECTED%') then
    raise exception 'FAIL: the rejection is not in the contact log';
  end if;
  raise notice 'PASS: delivered, 48500 outstanding, reason logged for the office to chase';
end $$;

\echo '=== K3c. only dispatch decides ==='
do $$
declare oid uuid;
begin
  oid := pg_temp.mk_cod('Rider Confirms');
  perform pg_temp.deliver(oid, 'kpay');

  set local role authenticated;
  -- The rider who delivered it must not be able to bless their own receipt.
  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  begin
    perform public.confirm_kpay_payment(oid);
    raise exception 'FAIL: a rider confirmed their own KPay payment';
  exception when insufficient_privilege then
    raise notice 'PASS: a rider cannot confirm their own receipt';
  end;

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  begin
    perform public.confirm_kpay_payment(oid);
    raise exception 'FAIL: a shop confirmed a KPay payment';
  exception when insufficient_privilege then
    raise notice 'PASS: a shop cannot confirm either';
  end;

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  perform public.confirm_kpay_payment(oid);
  raise notice 'PASS: dispatch can';

  reset role;
  perform set_config('request.jwt.claims','',false);
end $$;

\echo '=== K3d. a cash order is not a KPay decision to make ==='
do $$
declare oid uuid;
begin
  oid := pg_temp.mk_cod('Cash Not KPay');
  perform pg_temp.deliver(oid, 'cash');
  begin
    perform public.confirm_kpay_payment(oid);
    raise exception 'FAIL: confirmed a cash order as a KPay transfer';
  exception when object_not_in_prerequisite_state then
    raise notice 'PASS: not_a_kpay_payment refused';
  end;
end $$;


-- ============================================================================
--  K4. THE QUEUE
-- ============================================================================

\echo '=== K4. the admin queue shows exactly what is unchecked ==='
do $$
declare v_pending int; v_settled int;
begin
  select count(*) filter (where cod_status = 'kpay_pending'),
         count(*) filter (where collected_via = 'kpay' and cod_status = 'settled')
    into v_pending, v_settled
    from public.orders where collected_via = 'kpay';

  -- One left unconfirmed by K2's receiptless attempt? No: that one never
  -- delivered. The pending set is exactly the deliveries nobody has decided on.
  raise notice 'PASS: % awaiting a decision, % confirmed', v_pending, v_settled;

  if exists (select 1 from public.orders
              where cod_status = 'kpay_pending' and status <> 'delivered') then
    raise exception 'FAIL: something is awaiting KPay verification without being delivered';
  end if;
end $$;

\echo ''
\echo '####  ALL KPAY CHECKS PASSED  ####'
