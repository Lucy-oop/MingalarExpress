#!/usr/bin/env bash
#
# Clear the operational data — runs, parcels, money — and keep everything that
# is configuration or a person.
#
#   DATABASE_URL='postgresql://...' bash scripts/db-reset-runs.sh          # dry run
#   DATABASE_URL='postgresql://...' bash scripts/db-reset-runs.sh --yes    # do it
#
# STAGING ONLY. It is irreversible and there is no undo.
#
# ---------------------------------------------------------------------------
# WHAT IT REMOVES
#
#   trips                  the runs
#   orders                 every parcel, and by cascade its status events,
#                          its notes and its assignment rows
#   cod_ledger             every money line, including trip_pay
#   settlements            every settlement
#   storage.objects        delivery proof photos and KPay receipts
#
# WHAT IT KEEPS, deliberately
#
#   auth.users, profiles   the people
#   shops                  including their approval state
#   rider_profiles         the riders, with their counters reset to idle
#   routes, route_areas, route_pay_tiers
#                          ROUTE CONFIGURATION. "Clear all active routes" is
#                          almost certainly not meant literally: these carry the
#                          per-parcel fees, the ward-to-route mapping and the pay
#                          tiers, `trips -> routes` is ON DELETE RESTRICT, and
#                          without them the dispatcher cannot plan anything. If
#                          you really do want them rebuilt, that is seed.sql.
#   service_areas          the 24 wards
#   app_settings           rates, ceilings, KPay account, support number
#   schema_migrations      the ledger. Wiping it would tell db-push.sh this
#                          database has never been migrated.
#   audit_log              kept on purpose: it references orders only by a text
#                          entity_id, so it breaks nothing, and it is the only
#                          record of what the office did. --with-audit to clear.
#
# ---------------------------------------------------------------------------
# WHY TRUNCATE AND NOT DELETE
#
# Two reasons, both load-bearing.
#
#   `cod_ledger -> orders` is ON DELETE RESTRICT, so a DELETE on orders fails
#   while any money line points at one. TRUNCATE of the whole set at once
#   satisfies that in a single statement.
#
#   `delivered`, `cancelled` and `returned` are TERMINAL in
#   tg_orders_status_machine, so the obvious alternative -- rewinding parcels to
#   `pending` and keeping the history -- raises illegal_transition on the first
#   delivered row. TRUNCATE also bypasses row triggers entirely, so nothing
#   fires audit rows or ledger lines on the way out.
#
# Every referencing table is named explicitly rather than using CASCADE: CASCADE
# would silently empty whatever else happens to point at these, which on a
# schema that grows is exactly the surprise you do not want from a reset script.
set -euo pipefail

CONFIRM=0
WITH_AUDIT=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --yes)         CONFIRM=1 ;;
    --with-audit)  WITH_AUDIT=1 ;;
    --force)       FORCE=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set. See scripts/db-push.sh for where to find it." >&2
  exit 2
fi

psql_q() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAq -c "$1"; }

HOST=$(printf '%s' "$DATABASE_URL" | sed -E 's#.*@([^/:]+).*#\1#')
echo "--- target"
echo "  host    $HOST"
echo "  db      $(psql_q 'select current_database()')"

echo "--- what is there now"
for t in trips orders cod_ledger settlements order_status_events order_notes; do
  printf '  %-22s %s\n' "$t" "$(psql_q "select count(*) from public.$t")"
done
printf '  %-22s %s\n' "storage.objects" "$(psql_q 'select count(*) from storage.objects')"
echo "--- kept"
for t in profiles shops rider_profiles routes service_areas; do
  printf '  %-22s %s\n' "$t" "$(psql_q "select count(*) from public.$t")"
done

ORDERS=$(psql_q 'select count(*) from public.orders')

# A blunt proxy for "this might not be staging". A test database does not
# accumulate thousands of parcels, and being wrong about which database this is
# costs more than an extra flag.
if [[ "$ORDERS" -gt 2000 && "$FORCE" -eq 0 ]]; then
  echo >&2
  echo "  REFUSING: $ORDERS orders is more than a test database should hold." >&2
  echo "  If this really is staging, re-run with --force." >&2
  exit 1
fi

if [[ "$CONFIRM" -eq 0 ]]; then
  echo
  echo "  Dry run. Nothing was changed."
  echo "  Re-run with --yes to clear the tables listed above."
  exit 0
fi

echo "--- clearing"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
begin;

-- One statement, every referencing table named. See the note above on why this
-- is TRUNCATE and not DELETE.
truncate table
  public.orders,
  public.order_status_events,
  public.order_notes,
  public.order_assignments,
  public.cod_ledger,
  public.settlements,
  public.trips
restart identity;

-- Proof photos and KPay receipts. The rows go; the objects behind them are left
-- in the storage backend, which is harmless on staging and is not something SQL
-- can reach.
delete from storage.objects;

/*
  RIDERS BACK TO IDLE. active_order_count is maintained by trigger as parcels
  move, so truncating orders leaves it frozen at whatever it was -- and a rider
  showing 3/3 parcels is one the dispatcher cannot assign anything to, on a
  database with no parcels at all. availability follows the same logic.

  is_online is left ALONE: it is the rider's own switch, and flipping it here
  would put someone on the map who has not started their shift.
*/
update public.rider_profiles
   set active_order_count = 0,
       availability       = 'available';

/*
  Order codes start from 1 again. `order_seq` is a standalone sequence read by
  the orders.code DEFAULT, not an identity column, so RESTART IDENTITY above
  does not touch it -- without this the first fresh parcel is MGE-<today>-000042
  and looks like a continuation of data that is gone.
*/
alter sequence public.order_seq restart with 1;

commit;
SQL

if [[ "$WITH_AUDIT" -eq 1 ]]; then
  echo "  audit_log as well"
  psql_q 'truncate table public.audit_log restart identity' >/dev/null
fi

echo "--- after"
for t in trips orders cod_ledger settlements; do
  printf '  %-22s %s\n' "$t" "$(psql_q "select count(*) from public.$t")"
done
printf '  %-22s %s\n' "audit_log" "$(psql_q 'select count(*) from public.audit_log')"
printf '  %-22s %s\n' "schema_migrations" "$(psql_q "select coalesce((select count(*)::text from public.schema_migrations), '(not yet created)')")"
echo "--- done"
