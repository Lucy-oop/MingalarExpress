#!/usr/bin/env bash
# Full local verification: reset public schema, apply every migration + seed, run tests.
# Usage: supabase/tests/reset_and_verify.sh [container_name]
set -euo pipefail
C="${1:-mge-verify}"
run() { docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q; }

echo "--- reset"
docker exec "$C" psql -U postgres -d postgres -q -c "
  drop trigger if exists on_auth_user_created on auth.users;
  do \$\$ declare r record; begin
    for r in select policyname from pg_policies where schemaname='storage' and tablename='objects'
    loop execute format('drop policy if exists %I on storage.objects', r.policyname); end loop;
  end \$\$;
  delete from storage.objects; delete from storage.buckets;
  drop schema public cascade; create schema public;
  grant usage on schema public to anon, authenticated, service_role;
  delete from auth.users;
" >/dev/null

for f in supabase/migrations/*.sql; do
  echo "--- apply $(basename "$f")"
  run < "$f"
done
echo "--- seed"; run < supabase/seed.sql
for t in rls_smoke lifecycle_edge storage_policies assign_flow settlement_flow route_flow failed_flow; do
  echo "--- test $t"
  # each suite assumes a clean DB, so reseed between them
  if [ "$t" != "rls_smoke" ]; then
    docker exec "$C" psql -U postgres -d postgres -q -c "
      truncate public.orders, public.cod_ledger, public.settlements,
               public.order_assignments, public.order_status_events,
               public.trips, public.audit_log restart identity cascade;
      delete from storage.objects;
      update public.rider_profiles set active_order_count=0, availability='available',
             is_online=true, last_ping_at=now(), max_active_orders=3, coverage_km=5;
      update public.rider_profiles set coverage_km=3 where id='66666666-6666-6666-6666-666666666666';
      delete from public.shops where id='aaaaaaaa-0000-0000-0000-000000000002';
      delete from public.profiles where id='77777777-7777-7777-7777-777777777777';
      delete from auth.users where id='77777777-7777-7777-7777-777777777777';
      update public.app_settings set rider_commission_pct=80, min_parcels_per_trip=20,
             max_delivery_attempts=3 where id;
      -- route_flow flips these while proving the ceilings bite; put them back so
      -- a re-run starts from the shipped configuration.
      update public.routes set is_active=true, max_parcels_per_trip=60,
             max_cod_per_trip=2000000;
      delete from public.route_pay_tiers where route_id is not null;" >/dev/null
    run < supabase/seed.sql
  fi
  docker exec -i "$C" psql -U postgres -d postgres < "supabase/tests/$t.sql" 2>&1 \
    | grep -E "PASS|FAIL|ERROR|ALL " || true
done

echo "--- summary"
docker exec -i "$C" psql -U postgres -d postgres -tAc "select 1" >/dev/null
