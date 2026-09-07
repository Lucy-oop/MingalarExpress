#!/usr/bin/env bash
#
# Regenerate types/database.types.ts — safely.
#
#   bash scripts/db-types.sh                 # against the local Supabase
#   bash scripts/db-types.sh --project-id X  # against a hosted project
#
# WHY THIS EXISTS. The script used to be a one-liner in package.json:
#
#     supabase gen types typescript --local --schema public > types/database.types.ts
#
# The `>` truncates the target BEFORE the command runs, so anything that goes
# wrong leaves the file destroyed rather than untouched. That happened three
# times in one week, twice silently:
#
#   * the Supabase CLI is not always on PATH, so the redirect emptied the file
#     and the build died on a thousand missing types
#   * worse, when the CLI *did* run but against a database missing the newest
#     migrations, it produced a perfectly valid file with `policy_acceptances`
#     and the `shops` approval columns quietly absent. tsc then failed in five
#     unrelated files and the cause looked nothing like the effect.
#
# So this does three things the redirect cannot: generate somewhere else first,
# refuse output that is missing things we know are in the schema, and only then
# move it into place. A failure leaves the working file exactly as it was.
#
# THE SENTINELS ARE THE POINT. A non-empty check would have caught the first
# failure and none of the others. Everything in REQUIRE below has been lost to a
# stale regeneration at least once; add to it whenever a migration lands
# something the app depends on.
set -euo pipefail

OUT="types/database.types.ts"
TARGET=("${@:---local}")

REQUIRE=(
  # the shape itself
  "export type Database"
  # 0023 — dropped by a stale regeneration, twice
  "policy_acceptances"
  # 0026 — the shop approval columns, dropped with it
  "approved_at"
  "goods_type"
  # 0025 — the bulk collection RPC, absent until hand-patched
  "advance_orders"
  # 0028/0029 — collect before deliver
  "picked_up_at"
  # 0033 — the rate card. Hand-patched, so a stale regeneration silently
  # reverts every fee lookup in lib/orders/queries.ts to a type error.
  "delivery_zones"
  "zone_id"
  # 0035 — the office notice feed's only stored fact.
  "notices_seen_at"
)

if ! command -v supabase >/dev/null 2>&1; then
  cat >&2 <<'MSG'
  supabase CLI not found on PATH, so types cannot be regenerated.

    npm i -g supabase      (or: brew install supabase/tap/supabase)

  types/database.types.ts has NOT been touched.
MSG
  exit 1
fi

TMP="$(mktemp -t mge-types.XXXXXX)"
trap 'rm -f "$TMP"' EXIT

echo "--- generating (${TARGET[*]})"
if ! supabase gen types typescript "${TARGET[@]}" --schema public > "$TMP" 2>"$TMP.err"; then
  echo "  generation failed:" >&2
  sed 's/^/    /' "$TMP.err" >&2
  rm -f "$TMP.err"
  echo "  $OUT has NOT been touched." >&2
  exit 1
fi
rm -f "$TMP.err"

BYTES=$(wc -c < "$TMP" | tr -d ' ')
if [ "$BYTES" -lt 10000 ]; then
  echo "  output is only ${BYTES} bytes — that is not a schema." >&2
  echo "  $OUT has NOT been touched." >&2
  exit 1
fi

MISSING=""
for needle in "${REQUIRE[@]}"; do
  grep -q -- "$needle" "$TMP" || MISSING="$MISSING $needle"
done

if [ -n "$MISSING" ]; then
  cat >&2 <<MSG
  The generated types are MISSING:$MISSING

  That means the database this was generated from is behind the migrations in
  this repo — not that the types are wrong. Writing it out would delete those
  definitions and break the build somewhere unrelated.

  Apply the missing migrations to that database first, then re-run.

  $OUT has NOT been touched.
MSG
  exit 1
fi

if cmp -s "$TMP" "$OUT"; then
  echo "  no change (${BYTES} bytes)"
  exit 0
fi

mv "$TMP" "$OUT"
trap - EXIT
echo "  wrote $OUT (${BYTES} bytes)"
echo "  review the diff before committing: git diff --stat $OUT"
