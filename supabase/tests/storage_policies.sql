-- ============================================================================
--  PHASE 1 — STORAGE POLICY TESTS (delivery-proofs bucket)
--  Proof photos are COD-dispute evidence: write-once, party-scoped reads.
-- ============================================================================
\set ON_ERROR_STOP on
-- assign + pick up an order for rider1
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',false);
set role authenticated;
select public.assign_order((select id from public.orders where status='pending' order by created_at limit 1),
                           '44444444-4444-4444-4444-444444444444') is not null as assigned;
reset role;

\echo '=== S1. assigned rider CAN upload to its own order folder ==='
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}',false);
set role authenticated;
do $$
declare oid uuid;
begin
  select id into oid from public.orders where rider_id=auth.uid() and status='assigned' limit 1;
  insert into storage.objects (bucket_id, name, owner)
  values ('delivery-proofs', oid::text || '/proof-1.webp', auth.uid());
  raise notice 'PASS: assigned rider uploaded proof';
end $$;

\echo '=== S2. rider CANNOT upload to an order that is not theirs ==='
do $$
declare oid uuid;
begin
  select id into oid from public.orders where rider_id is null limit 1;
  insert into storage.objects (bucket_id, name, owner)
  values ('delivery-proofs', oid::text || '/forged.webp', auth.uid());
  raise exception 'FAIL: rider uploaded proof for someone else''s order';
exception
  when insufficient_privilege then raise notice 'PASS: upload to foreign order denied';
end $$;

\echo '=== S3. rider CANNOT upload to a bucket root (no order folder) ==='
do $$
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('delivery-proofs', 'loose-file.webp', auth.uid());
  raise exception 'FAIL: path convention not enforced';
exception
  when insufficient_privilege then raise notice 'PASS: bucket-root upload denied';
end $$;

\echo '=== S4. another rider CANNOT read that proof ==='
reset role;
select set_config('request.jwt.claims','{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}',false);
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from storage.objects where bucket_id='delivery-proofs';
  if n <> 0 then raise exception 'FAIL: unrelated rider sees % proof(s)', n; end if;
  raise notice 'PASS: unrelated rider sees 0 proofs';
end $$;

\echo '=== S5. the sending shop and dispatch CAN read it ==='
reset role;
select set_config('request.jwt.claims','{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',false);
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from storage.objects where bucket_id='delivery-proofs';
  if n <> 1 then raise exception 'FAIL: sending shop sees % proofs, expected 1', n; end if;
  raise notice 'PASS: sending shop can read the proof';
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',false);
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from storage.objects where bucket_id='delivery-proofs';
  if n <> 1 then raise exception 'FAIL: dispatch sees % proofs', n; end if;
  raise notice 'PASS: dispatch can read the proof';
end $$;

\echo '=== S6. nobody but super_admin may delete a proof; no UPDATE at all ==='
do $$
begin
  delete from storage.objects where bucket_id='delivery-proofs';
  if found then raise exception 'FAIL: dispatcher deleted a proof'; end if;
  raise notice 'PASS: dispatcher delete affected no rows';
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',false);
set role authenticated;
do $$
declare n int;
begin
  update storage.objects set name='tampered.webp' where bucket_id='delivery-proofs';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: proof was renamed (% rows)', n; end if;
  raise notice 'PASS: no UPDATE policy -> proof cannot be overwritten';
  delete from storage.objects where bucket_id='delivery-proofs';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: super_admin could not delete (% rows)', n; end if;
  raise notice 'PASS: super_admin can delete evidence when required';
end $$;
reset role;
\echo '####  ALL STORAGE CHECKS PASSED  ####'
