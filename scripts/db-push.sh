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

# ----------------------------------------------------------------------------
#  PREFLIGHT — what does this database already have?
#
#  0030 introduced public.schema_migrations, so there are three states and they
#  need different treatment. Before it existed this script could only ask "does
#  public.profiles exist?", which answers "migrated at all" and not "migrated to
#  where" -- so it refused against any live project and its own message told you
#  to apply the newer files by hand, one psql call each, in the right order. That
#  is fine for three files and is how the last push was done. It does not scale,
#  and a half-applied function is invisible.
# ----------------------------------------------------------------------------
echo "--- preflight"
HAS_PROFILES=$(psql_q "select coalesce(to_regclass('public.profiles')::text, '')")
HAS_LEDGER=$(psql_q "select coalesce(to_regclass('public.schema_migrations')::text, '')")

LEDGER_MIGRATION="supabase/migrations/20260907110000_schema_migrations.sql"

if [[ -z "$HAS_LEDGER" && -n "$HAS_PROFILES" && "$FORCE" -eq 0 ]]; then
  cat >&2 <<MSG
  This database was migrated before the ledger existed, so nothing here knows
  which files it has. Apply the ledger migration once, by hand:

    psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -f $LEDGER_MIGRATION

  It records every migration up to and including itself as applied. Then re-run
  this script and it will apply only what is genuinely missing.

  Read that file before you run it if this database might be PARTIALLY
  migrated -- it asserts the whole history, and a file it wrongly records as
  applied is a file that will never be applied.
MSG
  exit 1
fi

if [[ -z "$HAS_LEDGER" ]]; then
  echo "  fresh database"
else
  echo "  ledger present: $(psql_q "select count(*) from public.schema_migrations") migration(s) recorded"
fi

# ----------------------------------------------------------------------------
#  MIGRATIONS — only what is missing, in filename order
# ----------------------------------------------------------------------------
echo "--- migrations"
APPLIED_ANY=0
PRE_LEDGER=""
for f in supabase/migrations/*.sql; do
  BASE="$(basename "$f")"
  SUM=$(md5 -q "$f" 2>/dev/null || md5sum "$f" | cut -d' ' -f1)

  if [[ -n "$HAS_LEDGER" ]]; then
    ROW=$(psql_q "select coalesce(checksum, '-') from public.schema_migrations
                   where filename = '$BASE'")
    if [[ -n "$ROW" ]]; then
      # Already applied. An applied migration is history: if the file has
      # changed since, the database and the repo disagree about what ran and
      # only a human can say which is right.
      if [[ "$ROW" != "-" && "$ROW" != "$SUM" ]]; then
        printf '  %-48s' "$BASE"
        echo "CHANGED SINCE IT WAS APPLIED" >&2
        cat >&2 <<MSG

  $BASE was applied with a different checksum.

    recorded  $ROW
    on disk   $SUM

  Migrations are forward-only, so an applied file should never be edited. Either
  the edit belongs in a NEW migration, or this database ran something the repo
  no longer contains. --force to ignore.
MSG
        [[ "$FORCE" -eq 0 ]] && exit 1
      fi
      printf '  %-48s skip\n' "$BASE"
      continue
    fi
  fi

  printf '  %-48s' "$BASE"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"

  # On a FRESH database the ledger does not exist until 0030 creates it, so
  # there is nowhere to record 0001..0029 as they run. Their names are held
  # here and their checksums written the moment the table appears.
  if [[ -z "$HAS_LEDGER" ]]; then
    HAS_LEDGER=$(psql_q "select coalesce(to_regclass('public.schema_migrations')::text, '')")
    if [[ -n "$HAS_LEDGER" ]]; then
      for pending in $PRE_LEDGER $BASE; do
        PSUM=$(md5 -q "supabase/migrations/$pending" 2>/dev/null \
               || md5sum "supabase/migrations/$pending" | cut -d' ' -f1)
        psql_q "insert into public.schema_migrations (filename, checksum)
                values ('$pending', '$PSUM')
                on conflict (filename) do update set checksum = excluded.checksum" >/dev/null
      done
      PRE_LEDGER=""
    else
      PRE_LEDGER="$PRE_LEDGER $BASE"
    fi
  else
    # Recorded only after it applied cleanly, and never before: a row for a
    # file that failed halfway is worse than no row at all.
    psql_q "insert into public.schema_migrations (filename, checksum)
            values ('$BASE', '$SUM')
            on conflict (filename) do update set checksum = excluded.checksum" >/dev/null
  fi

  APPLIED_ANY=1
  echo "OK"
done

if [[ -n "$PRE_LEDGER" ]]; then
  echo "  note: applied before the ledger migration, so unrecorded:$PRE_LEDGER" >&2
fi

if [[ "$APPLIED_ANY" -eq 0 ]]; then
  echo "  nothing to do -- this database is up to date"
fi

# ----------------------------------------------------------------------------
#  TELL PostgREST, because the database is only half the story.
#
#  PostgREST keeps its own cached picture of the schema and will not notice a
#  new table until it is reloaded. It polls, so this heals on its own within a
#  minute or so -- long enough to look exactly like a migration that did not
#  apply. That is what 0033 did on staging:
#
#      zones unavailable: Could not find the table 'public.delivery_zones'
#                         in the schema cache
#
#  applied cleanly, invisible to the app. One NOTIFY closes the window. Only
#  when something was actually applied, and never allowed to fail the push --
#  the migrations are already committed by this point, so a failed cache hint is
#  a wait, not an error.
# ----------------------------------------------------------------------------
if [[ "$APPLIED_ANY" -eq 1 ]]; then
  echo "--- reload the PostgREST schema cache"
  if psql "$DATABASE_URL" -q -c "notify pgrst, 'reload schema';" 2>/dev/null; then
    echo "  notified"
  else
    echo "  could not notify — the API will pick the change up within a minute"
  fi
fi

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
