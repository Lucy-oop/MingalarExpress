#!/usr/bin/env bash
#
# Clear the operational data AND the people it belongs to — back to a database
# with configuration, one office login, and nothing else.
#
#   bash scripts/db-reset-all.sh          # dry run: says what it would do
#   bash scripts/db-reset-all.sh --yes    # do it
#
# STAGING ONLY. It is irreversible and there is no undo.
#
# ---------------------------------------------------------------------------
# WHY THIS EXISTS ALONGSIDE db-reset-runs.sh
#
# `db-reset-runs.sh` clears the WORK and keeps the PEOPLE — the right tool when
# you want the same shops and riders to start a fresh day. This one goes
# further: it removes the shop owners and riders too, so the next test starts at
# registration rather than at a run. Asked for three times now; doing it by hand
# a fourth time is how a wrong DELETE eventually happens.
#
# It also uses a different transport. `db-reset-runs.sh` needs a DATABASE_URL
# for psql; this project's .env.local carries only the project URL and the
# service-role key, so this script speaks PostgREST and the Auth Admin API over
# curl. That is not a workaround: account removal REQUIRES the Admin API (see
# below), so a psql-only script could not finish the job anyway.
#
# ---------------------------------------------------------------------------
# WHAT IT REMOVES
#
#   cod_ledger             every money line, including trip_pay
#   settlements            every settlement
#   orders                 every parcel, and by cascade its status events, its
#                          notes and its assignment rows
#   trips                  the runs
#   shops                  every shop, including its approval state
#   auth.users             every shop_owner, rider and dispatcher account, and
#                          by cascade profiles -> rider_profiles,
#                          policy_acceptances
#   storage.objects        delivery proof photos, KPay receipts, avatars
#
# WHAT IT KEEPS, deliberately
#
#   the super_admin(s)     the office's own login. Refuses to run if it cannot
#                          find one, because a database nobody can sign into is
#                          not a clean slate, it is a locked door.
#   routes, route_areas, route_pay_tiers
#                          route configuration: per-parcel fees, the
#                          ward-to-route mapping, the pay tiers. `trips ->
#                          routes` is ON DELETE RESTRICT and without them
#                          nothing can be planned.
#   service_areas          the wards, and their zone assignments
#   delivery_zones         the fee bands. `service_areas.zone_id -> zones` is
#                          RESTRICT, so these could not go without the wards.
#   app_settings           rates, ceilings, KPay account, support number
#   schema_migrations      the ledger. Wiping it would tell db-push.sh this
#                          database has never been migrated.
#   audit_log              kept on purpose. Its actor_id merely goes NULL, and
#                          it is the only record of what the office did —
#                          including this reset.
#
# ---------------------------------------------------------------------------
# THE ORDER IS NOT A PREFERENCE
#
# Six ON DELETE RESTRICT edges force it:
#
#   cod_ledger.order_id      -> orders
#   cod_ledger.rider_id      -> rider_profiles
#   settlements.rider_id     -> rider_profiles
#   orders.shop_id           -> shops
#   orders.created_by        -> profiles
#   shops.owner_id           -> profiles
#
# Money first (nothing points at it), then parcels, then runs, then shops, then
# the people. Do it in any other order and the delete is refused.
#
# ---------------------------------------------------------------------------
# WHY ACCOUNTS CANNOT GO THROUGH PostgREST
#
# `profiles.id` is a foreign key to `auth.users(id)` ON DELETE CASCADE, and the
# cascade only runs auth.users -> profiles. Deleting the profile row directly
# leaves a live `auth.users` row still holding the email and phone: the account
# can no longer sign in (auth_role() returns NULL and every policy fails closed)
# but its credentials still occupy GoTrue, so re-registering that merchant fails
# on a duplicate nobody can see. That is the half-state lib/admin/actions.ts is
# written around.
#
# So accounts go through `DELETE /auth/v1/admin/users/{id}` and the CASCADE
# takes out profiles, rider_profiles and policy_acceptances. The child cleanup
# above is a PRECONDITION for it, not a tidy-up: with an order or a shop still
# pointing at a profile, the Admin API surfaces the RESTRICT as an opaque
# 500 "Database error deleting user".
#
# ---------------------------------------------------------------------------
# TWO THINGS IT DELIBERATELY DOES NOT DO
#
#   IT DOES NOT RESET order_seq. It cannot — that needs DDL, which the
#   service-role key does not carry through PostgREST — and it should not: a
#   tracking code must never be reused. A customer holding an old
#   MGE-260908-000041 slip must not be able to match a new parcel.
#
#   IT DOES NOT RE-SEED. `supabase/seed.sql` inserts six accounts directly into
#   auth.users, including dispatch@mingalar.test, so seeding after this would
#   put back the dispatcher role the app retired. Never follow this with
#   `scripts/db-push.sh --seed`; plain db:push applies migrations only.
set -euo pipefail

ARM=0
for arg in "$@"; do
  case "$arg" in
    --yes) ARM=1 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

if [[ ! -f .env.local ]]; then
  echo "no .env.local — cannot find the project URL or the service-role key" >&2
  exit 1
fi
set -a; . ./.env.local; set +a

: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is not set}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is not set}"

BASE="${NEXT_PUBLIC_SUPABASE_URL%/}"
AUTH=(-H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}"
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}")

say() { printf '%s\n' "$*"; }
rule() { printf '%s\n' "------------------------------------------------------------"; }

# Exact row count for a table, via PostgREST's Content-Range header.
#
# No `select=` on purpose. Asking for `id` returned a blank for route_areas,
# whose primary key is (route_id, area_id) — there is no id column, so the
# request 400s and the count silently comes back empty. `Range: 0-0` already
# keeps the body to one row, so naming a column bought nothing and assumed a
# schema convention this database does not follow everywhere.
count() {
  curl -fsS -I -G "$BASE/rest/v1/$1" \
    -H 'Prefer: count=exact' -H 'Range: 0-0' "${AUTH[@]}" 2>/dev/null \
  | tr -d '\r' | sed -n 's|.*content-range: .*/||Ip'
}

say "Mingalar Express — full reset"
say "project: $BASE"
rule

# ---------------------------------------------------------------------------
# Preflight. Refuse rather than guess.
# ---------------------------------------------------------------------------
PROFILES_JSON="$(curl -fsS -G "$BASE/rest/v1/profiles" \
  --data-urlencode 'select=id,full_name,role,phone' --data-urlencode 'order=role' \
  "${AUTH[@]}")" || { say "cannot reach PostgREST — check the URL and key"; exit 1; }

KEEP_IDS="$(printf '%s' "$PROFILES_JSON" | python3 -c "
import json,sys
print('\n'.join(p['id'] for p in json.load(sys.stdin) if p['role'] == 'super_admin'))")"
DROP_JSON="$(printf '%s' "$PROFILES_JSON" | python3 -c "
import json,sys
print(json.dumps([p for p in json.load(sys.stdin) if p['role'] != 'super_admin']))")"

if [[ -z "$KEEP_IDS" ]]; then
  say "REFUSING: no super_admin found. Deleting every account would leave a"
  say "database nobody can sign into. Bootstrap an admin first — see"
  say "docs/RUNBOOK.md, 'Production — wards only, then bootstrap one admin'."
  exit 1
fi

say "KEEPING $(printf '%s\n' "$KEEP_IDS" | grep -c .) super_admin account(s):"
printf '%s' "$PROFILES_JSON" | python3 -c "
import json,sys
for p in json.load(sys.stdin):
    if p['role'] == 'super_admin':
        print(f\"    {p['full_name']:<30} {p['phone'] or '-':<16} {p['id']}\")"

DROP_COUNT="$(printf '%s' "$DROP_JSON" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))')"
say ""
say "DELETING $DROP_COUNT account(s):"
printf '%s' "$DROP_JSON" | python3 -c "
import json,sys
for p in json.load(sys.stdin):
    print(f\"    {p['role']:<12} {p['full_name']:<30} {p['phone'] or '-':<16} {p['id']}\")"

say ""
say "DELETING rows:"
for t in cod_ledger settlements order_status_events order_notes order_assignments orders trips shops rider_profiles; do
  printf '    %-22s %s\n' "$t" "$(count "$t")"
done
say ""
say "KEEPING rows:"
for t in routes route_areas route_pay_tiers service_areas delivery_zones app_settings; do
  printf '    %-22s %s\n' "$t" "$(count "$t")"
done
rule

if [[ "$ARM" -eq 0 ]]; then
  say "DRY RUN — nothing was changed. Re-run with --yes to do it."
  exit 0
fi

# ---------------------------------------------------------------------------
# 1-5. The rows, in the order the RESTRICT edges force.
#
# `id=not.is.null` matches everything. PostgREST refuses an unfiltered DELETE,
# which is a good default and the reason for the filter rather than a trick.
# ---------------------------------------------------------------------------
say "deleting rows..."
for t in cod_ledger settlements orders trips shops; do
  code="$(curl -fsS -o /dev/null -w '%{http_code}' -X DELETE \
    "$BASE/rest/v1/$t?id=not.is.null" -H 'Prefer: return=minimal' "${AUTH[@]}")"
  printf '    %-22s HTTP %s\n' "$t" "$code"
  if [[ "$code" != "204" ]]; then
    say "    stopping: $t did not delete cleanly. Nothing after this ran."
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# 6. The accounts. CASCADE from auth.users takes profiles, rider_profiles and
#    policy_acceptances with them.
# ---------------------------------------------------------------------------
say "deleting accounts..."
printf '%s' "$DROP_JSON" | python3 -c "
import json,sys
for p in json.load(sys.stdin):
    print(p['id'], p['role'], p['full_name'])" | while read -r id role name; do
  code="$(curl -fsS -o /dev/null -w '%{http_code}' -X DELETE \
    "$BASE/auth/v1/admin/users/$id" "${AUTH[@]}")"
  printf '    %-12s %-30s HTTP %s\n' "$role" "$name" "$code"
done

# ---------------------------------------------------------------------------
# 7. Storage. `storage.objects` has NO foreign key to anything, so proof photos
#    and avatars survive every delete above as orphans pointing at order and
#    profile ids that no longer exist.
#
#    Listed one prefix deep because the buckets are laid out
#    delivery-proofs/<order_id>/<file> and avatars/<profile_id>/<file>: the
#    top-level listing returns folders, whose entries have a null id.
# ---------------------------------------------------------------------------
say "deleting storage objects..."
for bucket in delivery-proofs avatars; do
  removed=0
  folders="$(curl -fsS -X POST "$BASE/storage/v1/object/list/$bucket" \
    -H 'Content-Type: application/json' "${AUTH[@]}" \
    -d '{"prefix":"","limit":1000}' \
    | python3 -c "
import json,sys
try: rows = json.load(sys.stdin)
except Exception: rows = []
for r in rows if isinstance(rows, list) else []:
    print(r['name'])")"
  for folder in $folders; do
    files="$(curl -fsS -X POST "$BASE/storage/v1/object/list/$bucket" \
      -H 'Content-Type: application/json' "${AUTH[@]}" \
      -d "{\"prefix\":\"$folder\",\"limit\":1000}" \
      | python3 -c "
import json,sys
try: rows = json.load(sys.stdin)
except Exception: rows = []
for r in rows if isinstance(rows, list) else []:
    if r.get('id'): print(r['name'])")"
    for f in $files; do
      curl -fsS -o /dev/null -X DELETE "$BASE/storage/v1/object/$bucket/$folder/$f" \
        "${AUTH[@]}" && removed=$((removed + 1)) || true
    done
    # A file may sit at the bucket root rather than in a folder.
    if [[ -z "$files" ]]; then
      curl -fsS -o /dev/null -X DELETE "$BASE/storage/v1/object/$bucket/$folder" \
        "${AUTH[@]}" && removed=$((removed + 1)) || true
    fi
  done
  printf '    %-22s %s object(s)\n' "$bucket" "$removed"
done

# ---------------------------------------------------------------------------
# Verify. The script says what it left behind rather than claiming success.
# ---------------------------------------------------------------------------
rule
say "after:"
for t in orders trips shops rider_profiles cod_ledger settlements order_status_events order_notes order_assignments profiles; do
  printf '    %-22s %s\n' "$t" "$(count "$t")"
done
say ""
say "kept:"
for t in routes route_areas route_pay_tiers service_areas delivery_zones app_settings; do
  printf '    %-22s %s\n' "$t" "$(count "$t")"
done
say ""
say "remaining accounts:"
curl -fsS -G "$BASE/rest/v1/profiles" --data-urlencode 'select=full_name,role,phone' \
  "${AUTH[@]}" | python3 -c "
import json,sys
for p in json.load(sys.stdin):
    print(f\"    {p['role']:<12} {p['full_name']:<30} {p['phone'] or '-'}\")"
rule
say "Done. Do NOT run seed.sql or db-push.sh --seed — see the header."
