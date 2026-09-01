#!/usr/bin/env bash
#
# Apply supabase/migrations/*.sql (and optionally seed.sql) to a target database.
#
#   DATABASE_URL='postgresql://...' bash scripts/db-push.sh [--seed] [--force]
#
# This script is FORWARD-ONLY and never drops anything -- it is the opposite of
# supabase/tests/reset_and_verify.sh, which exists to destroy a throwaway.
#
# Why the "already migrated" guard: these migrations are not idempotent.
# 0001_init.sql runs bare `create type public.user_role as enum (...)` with no
# IF NOT EXISTS, so a second run fails partway through and leaves you guessing
# which statements landed. Re-running is a mistake worth catching up front.
set -euo pipefail

SEED=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --seed)  SEED=1 ;;
    --force) FORCE=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ -z "${DATABASE_URL:-}" ]]; then
  cat >&2 <<'MSG'
DATABASE_URL is not set.

  Supabase Dashboard -> Project Settings -> Database -> Connection string -> URI
  Use the DIRECT connection or the SESSION pooler, both on port 5432.
  Do NOT use the transaction pooler (6543): it holds no session state, and these
  migrations create extensions, types and triggers.

  export DATABASE_URL='postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres'
MSG
  exit 2
fi

# Never let this run at the local stack that belongs to another project.
if [[ "$DATABASE_URL" == *":54322/"* ]]; then
  echo "refusing: port 54322 is the Main_project local stack, not Mingalar." >&2
  exit 1
fi
if [[ "$DATABASE_URL" == *":55432/"* ]]; then
  echo "note: 55432 is the mge-verify throwaway. 'npm run db:verify' manages that one." >&2
fi

psql_q() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAq -c "$1"; }

echo "--- target"
psql_q "select 'server: ' || current_setting('server_version') || ' | db: ' || current_database() || ' | user: ' || current_user"

# Fail here rather than 400 lines into 0001 if the role cannot create extensions.
echo "--- preflight: postgis + pgcrypto"
if ! psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
      create extension if not exists pgcrypto with schema extensions;
      create extension if not exists postgis  with schema extensions;" 2>/dev/null; then
  echo "  could not create extensions. Enable PostGIS in the dashboard" >&2
  echo "  (Database -> Extensions -> postgis) and re-run." >&2
  exit 1
fi
psql_q "select '  postgis ' || extversion from pg_extension where extname='postgis'"

echo "--- preflight: is this database already migrated?"
EXISTING=$(psql_q "select coalesce(to_regclass('public.profiles')::text, '')")
if [[ -n "$EXISTING" && "$FORCE" -eq 0 ]]; then
  cat >&2 <<'MSG'
  public.profiles already exists, so this database has been migrated before.
  These migrations are not idempotent -- re-running 0001 fails on `create type`.

  Options:
    * fresh Supabase project, then re-run this script
    * or, if you are certain only LATER migrations are missing, apply those files
      individually with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <file>
    * --force to attempt it anyway (expect errors)
MSG
  exit 1
fi
echo "  clean"

echo "--- migrations"
for f in supabase/migrations/*.sql; do
  printf '  %-42s' "$(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  echo "OK"
done

if [[ "$SEED" -eq 1 ]]; then
  echo "--- seed (development / staging only)"
  echo "  seed.sql writes directly into auth.users and is coupled to the GoTrue"
  echo "  schema. Never run it against a production project."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql
  echo "  OK"
fi

echo "--- verify"
psql "$DATABASE_URL" -tAc "
select 'tables:      ' || count(*) from pg_tables where schemaname='public'
union all select 'functions:   ' || count(*) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
union all select 'rls enabled: ' || count(*) from pg_tables
  where schemaname='public' and rowsecurity
union all select 'policies:    ' || count(*) from pg_policies where schemaname='public'
union all select 'buckets:     ' || count(*) from storage.buckets
union all select 'wards:       ' || count(*) from public.service_areas
union all select 'auth users:  ' || count(*) from auth.users
union all select 'realtime:    ' || coalesce((select string_agg(tablename, ', ')
  from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'),
  '(publication absent)');"

echo "--- done"
