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
PASSED=0
ABORTED=""
for t in rls_smoke lifecycle_edge storage_policies assign_flow settlement_flow route_flow failed_flow kpay_flow; do
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
  # ----------------------------------------------------------------------------
  #  WHY THE BANNER IS THE CHECK, and not ON_ERROR_STOP.
  #
  #  This used to be a bare pipe into `grep ... || true`, which swallowed
  #  everything: when a suite hit a real error partway through, every assertion
  #  after the abort silently never ran and the script still exited 0. It cost a
  #  session of false confidence -- 206 assertions quietly became 132 while the
  #  exit code stayed green.
  #
  #  `psql -v ON_ERROR_STOP=1` is the obvious fix and is wrong here:
  #  failed_flow.sql deliberately provokes a top-level ERROR to prove a commit
  #  is refused, so stopping on the first error would abort the suite that is
  #  working correctly.
  #
  #  Every suite ends by echoing `####  ALL ... PASSED  ####`. A file that dies
  #  partway never reaches it. That is an exact signal for "did this finish",
  #  which is the actual question, and it tolerates a deliberate error.
  # ----------------------------------------------------------------------------
  # `|| true` so `set -e` does not kill the run at the substitution: psql can
  # exit non-zero here, and when it does we want the diagnostic below and the
  # remaining suites, not a script that vanishes mid-sentence.
  OUT=$(docker exec -i "$C" psql -U postgres -d postgres < "supabase/tests/$t.sql" 2>&1 || true)
  echo "$OUT" | grep -E "PASS|FAIL|ERROR|ALL " || true

  if ! printf '%s' "$OUT" | grep -q '####  ALL '; then
    echo "  !! $t ABORTED -- every assertion after the failure never ran" >&2
    ABORTED="$ABORTED $t"
  fi
  # An assertion that raised inside an exception handler would not abort the
  # file, so the explicit marker is checked too.
  if printf '%s' "$OUT" | grep -q 'FAIL:'; then
    echo "  !! $t reported a FAILED assertion" >&2
    ABORTED="$ABORTED $t"
  fi
  PASSED=$((PASSED + $(printf '%s' "$OUT" | grep -c 'PASS:')))
done

echo "--- summary"
docker exec -i "$C" psql -U postgres -d postgres -tAc "select 1" >/dev/null
echo "  $PASSED assertions passed"
if [ -n "$ABORTED" ]; then
  echo "  SUITES THAT DID NOT COMPLETE:$ABORTED" >&2
  exit 1
fi
