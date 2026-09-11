# Mingalar Express — setup, verification and deployment runbook

Covers connecting the app to a clean database, running migrations and seed,
verifying the schema, smoke-testing one order end to end, and shipping to
Vercel.

---

## 0. Read this first

Three facts about **this machine** that change the commands below.

| | |
|---|---|
| **The Supabase CLI is not installed.** | `supabase db push`, `supabase status` and `npm run db:types` all need it. Install it (§1) or use the `psql` path, which needs nothing extra. |
| **Check what is on ports 54321/54322 before trusting it.** | It is now the Mingalar stack (`supabase_db_mingalar`), but it has been a different project's before. `docker ps --format '{{.Names}}'` settles it in a second, and `.env.local` normally points at the cloud project regardless. |
| **There are TWENTY-TWO migrations.** | `0001`–`0022`, applied in filename order. Three are easy to skip and each breaks something silently: `0006` carries the settlement lifecycle and `admin_overview` (the Super Admin panel is dead without it), `0012` exists only to add one enum value because `ALTER TYPE … ADD VALUE` cannot be *used* in the transaction that adds it, `0015` repairs data as well as code — it realigns any parcel naming a different rider from its run. `0014` adds an SMS outbox that `0016` removes again — both are kept so a fresh database and staging agree — and `0017` puts a contact log in its place, and `0020` exists only to add the `kpay_pending` enum value that `0021` needs. |

### The one genuinely destructive command

`npm run db:verify` runs `supabase/tests/reset_and_verify.sh`, which begins with
`drop schema public cascade` and `delete from auth.users`.

It targets a **Docker container by name**, defaulting to `mge-verify`:

```bash
npm run db:verify              # -> container "mge-verify"   (safe, throwaway)
npm run db:verify -- other-db  # -> container "other-db"     (destroys it)
```

It cannot reach a cloud project — it only speaks `docker exec`. But never pass
it a container name you care about, and never point it at
`supabase_db_Main_project`.

---

## 1. Tooling

```bash
# Supabase CLI (needed for db push, gen types, and local stacks)
brew install supabase/tap/supabase
supabase --version

# psql — already present at /Library/PostgreSQL/18/bin/psql
psql --version

node -v     # v24.15.0 here; Vercel should be pinned to Node 20 or 22 LTS
```

---

## 2. Database setup

Pick **one** of the two paths.

### Path A — Supabase Cloud (recommended for staging and production)

1. Create a project at <https://supabase.com/dashboard>. Choose the region
   closest to Yangon — **Singapore (`ap-southeast-1`)**.
2. Enable **PostGIS**: Dashboard → Database → Extensions → search `postgis` →
   enable. Migration `0001` calls `create extension if not exists postgis with
   schema extensions`, which succeeds on Cloud, but enabling it first makes a
   permissions failure obvious immediately rather than 500 lines into the file.
3. Collect three values from Dashboard → Project Settings:
   - **API → Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **API → `anon` `public`** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **API → `service_role` `secret`** → `SUPABASE_SERVICE_ROLE_KEY`
   - **Database → Connection string → URI** → your `DATABASE_URL` for psql
4. Link the CLI (skip if using the psql path):
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   ```

> **Use the direct or session connection for migrations, never the transaction
> pooler.** The transaction pooler (port `6543`) holds no session state across
> statements, and these migrations create extensions, types and triggers. Both
> usable options are on port `5432`:
>
> * **Direct** — `db.<ref>.supabase.co:5432`. Resolves **AAAA only** on current
>   projects, so it needs IPv6 egress (or the IPv4 add-on). Fastest, and the
>   right default when your network has IPv6.
> * **Session pooler** — `aws-0-<region>.pooler.supabase.com:5432`, username
>   `postgres.<ref>`. IPv4-reachable. Use this from CI, office networks, or
>   anywhere `db.<ref>…` will not connect.

### Path B — a clean local stack

Because `Main_project` already occupies the default ports, a second stack needs
its own project ref and ports. From the repo root:

```bash
supabase init          # writes supabase/config.toml — set a unique project_id
supabase start         # prints URL, anon key and service_role key
supabase status        # reprints them at any time
```

Set `project_id = "mingalar"` in `supabase/config.toml` and shift the ports in
`[api]`, `[db]`, `[studio]` (e.g. 64321/64322/64323) so the two stacks coexist.

> `supabase start` applies everything in `supabase/migrations/` automatically.
> If you use this path, skip §3 and go straight to seeding.

---

## 3. `.env.local`

```bash
cp .env.example .env.local
```

Complete template — every key the app reads:

```bash
# ---------------------------------------------------------------------------
# Supabase  (Dashboard -> Project Settings -> API)
# ---------------------------------------------------------------------------
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...

# Server-only. Bypasses RLS entirely. Must NEVER be prefixed NEXT_PUBLIC_.
# lib/supabase/admin.ts is marked 'server-only', so a client import is a build
# error rather than a leaked key.
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

# ---------------------------------------------------------------------------
# Map provider  (lib/map/providers.ts)
#   dev  : osm       -- raw tile.openstreetmap.org, no key, rate limited
#   prod : maptiler | stadia | geoapify | self_hosted
# ---------------------------------------------------------------------------
NEXT_PUBLIC_MAP_PROVIDER=maptiler
NEXT_PUBLIC_MAP_API_KEY=YOUR_MAPTILER_KEY
NEXT_PUBLIC_MAP_TILE_URL=

# ---------------------------------------------------------------------------
# Geocoder -- configured SEPARATELY from tiles.
#   nominatim | maptiler | self_hosted   (geoapify is not implemented)
# Leave the base URL blank to use the provider's own default. The key falls
# back to NEXT_PUBLIC_MAP_API_KEY when both come from the same MapTiler account.
# ---------------------------------------------------------------------------
NEXT_PUBLIC_GEOCODER_PROVIDER=maptiler
NEXT_PUBLIC_GEOCODER_BASE_URL=
NEXT_PUBLIC_GEOCODER_API_KEY=

# Nominatim's usage policy REQUIRES a contactable identifier.
# Nominatim's policy requires a contactable identifier, but `User-Agent` is a
# forbidden header name so a browser fetch cannot send it. Honouring that needs
# a server-side proxy; the value is kept for when one exists.
NEXT_PUBLIC_GEOCODER_USER_AGENT="MingalarExpress/0.1 (ops@mingalar.example)"

# ---------------------------------------------------------------------------
# Thingangyun Township defaults
# ---------------------------------------------------------------------------
NEXT_PUBLIC_DEFAULT_CENTER_LAT=16.8409
NEXT_PUBLIC_DEFAULT_CENTER_LNG=96.1735
NEXT_PUBLIC_DEFAULT_ZOOM=14

# Only needed by psql commands in this runbook, not by the app.
DATABASE_URL=postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres
```

Notes:

- **`NEXT_PUBLIC_MAP_API_KEY` is public by design** — it ships in the browser
  bundle. Restrict it by HTTP referrer in the MapTiler dashboard; that is the
  only thing protecting your quota.
- `NEXT_PUBLIC_MAP_TILE_URL` overrides the provider's default tile template.
  Leave blank unless self-hosting.
- `NEXT_PUBLIC_MAP_PROVIDER=maptiler` with an **empty key does not fail the
  build.** `getMapProvider()` logs a `console.error` and silently falls back to
  rate-limited OSM tiles, so production would serve OSM under real traffic in
  breach of its usage policy, and look perfectly fine while doing it. The only
  reliable check is the DevTools one in section 8.
- `app_settings.map_provider` in the database records *which* provider ops
  chose. Keys never go in the database.

---

## 4. Migrations

All six, in filename order. `0002` depends on `0001`'s types, `0003` on
`0002`'s helper functions, `0006` on `0002`'s `build_settlement`. Order is not
optional.

### With the CLI

```bash
supabase db push          # applies every unapplied file in supabase/migrations/
supabase migration list   # confirm all six are marked applied
```

### With psql (no CLI needed)

```bash
export DATABASE_URL='postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres'
npm run db:push            # migrations only
npm run db:push -- --seed  # migrations + seed.sql
```

`scripts/db-push.sh` is forward-only and never drops anything. It refuses to
run against a database that already has `public.profiles`, because these
migrations are **not idempotent** — `0001` runs a bare
`create type public.user_role as enum (…)` with no `IF NOT EXISTS`, so a second
run fails partway and leaves you guessing which statements landed. It also
refuses port 54322 outright (that is the `Main_project` stack), pre-flights the
PostGIS and pgcrypto extensions so a permissions problem surfaces immediately
rather than 400 lines in, and prints object counts at the end.

The raw loop, if you would rather see every statement:

```bash
for f in supabase/migrations/*.sql; do
  echo "--- $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
```

Applied in this order:

```
20260825090100_init.sql                  enums, 11 tables, constraints, indexes, grants
20260825090200_triggers_rpc.sql          role helpers, guards, state machine, COD ledger, RPCs
20260825090300_rls.sql                   RLS on all tables + immutability revokes
20260825090400_storage.sql               delivery-proofs + avatars buckets and policies
20260825090500_offers_realtime.sql       offer/accept flow (RETIRED in 0009), realtime publication
20260825090600_settlement_admin.sql      settlement lifecycle, cod_positions, admin_overview
20260825090700_routes.sql                routes, route_areas, pay tiers, trips; Greater Yangon geofence
20260825090800_trips_rpc.sql             trip RPCs, trip_pay, depart_trip's 20-parcel override
20260825090900_retire_offer_engine.sql   offer engine dropped; assign_order inlined and kept
20260901090100_shop_panel.sql            orders.route_id, failed-parcel release, order_rider_card
20260902090100_failed_parcel_resolution  orders.resolution, attempt cap, resolve_failed_order
20260903090100_returned_status.sql       the `returned` enum value, alone (see the file's header)
20260903090200_return_leg.sql            return legs, receiver requirement, close/depart accounting
```

Two things that need **no dashboard clicks** because the migrations do them:

- **Storage buckets.** `0004` creates `delivery-proofs` (private, 5 MB, jpeg/webp/png)
  and `avatars`, with their RLS policies.
- **Realtime.** `0005` adds `orders` and `order_assignments` to the
  `supabase_realtime` publication if it exists. `rider_profiles` is deliberately
  excluded — a 20-second heartbeat from 40 riders is ~170k WAL events a day, and
  positions travel over Realtime *presence* instead.

> **Never run `supabase/tests/00_local_shim.sql` against a real project.** It
> fabricates `storage.*` and GoTrue columns that the bare Postgres image lacks.
> On a real project, Supabase's own services own those objects and the shim will
> corrupt them.

### Verify the schema landed

```bash
psql "$DATABASE_URL" -c "\dt public.*"     # expect 11 tables
psql "$DATABASE_URL" -tAc "select count(*) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';"
```

---

## 5. Seeding

`seed.sql` creates: 6 auth users, 8 Thingangyun wards, 1 shop, 3 positioned
riders, 2 pending orders.

### Dev and staging — the whole file

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

Seeded accounts, password `mingalar123` for all:

| Email | Role | |
|---|---|---|
| `admin@mingalar.test` | super_admin | Ko Aung |
| ~~`dispatch@mingalar.test`~~ | ~~dispatcher~~ | **Retired 2026-09-10.** The role is gone; the office is one login, `admin@mingalar.test`. `seed.sql` still creates this account — see the warning below |
| `shop@mingalar.test` | shop_owner | San Pya Mini Mart |
| `rider1@mingalar.test` | rider | Zaw Zaw — 0.33 km from the shop |
| `rider2@mingalar.test` | rider | Thiha — 1.6 km |
| `rider3@mingalar.test` | rider | Myo Min — 4.2 km, 3 km radius |

> `seed.sql` writes **directly into `auth.users`**. That is fine on a throwaway
> or staging database and is why every GoTrue token column is set to `''` —
> a single NULL (`reauthentication_token` is the usual one) makes sign-in fail
> with "Database error querying schema" while admin user creation still works.
> It is version-coupled to GoTrue, so do not use it on production.
>
> **And it resurrects the retired dispatcher role.** `seed.sql` inserts all six
> accounts including `dispatch@mingalar.test`, so seeding a database that was
> just wiped puts back the login this system no longer has a place for. After a
> reset, do **not** run `scripts/db-push.sh --seed`; plain `db:push` applies
> migrations only and is safe. `scripts/db-reset-all.sh` deliberately does not
> re-seed for this reason.

### Production — wards only, then bootstrap one admin

**1. Wards.** Every centroid below is an unverified placeholder good enough for
dev ranking. Replace with surveyed points or OSM boundary polygons before real
traffic — search the repo for `VERIFY-CENTROID`.

```sql
insert into public.service_areas (name, name_mm, sort_order, centroid) values
  ('San Pya',         'စံပြ',        10, extensions.st_point(96.1690, 16.8480)::extensions.geography),
  ('Lhay Htaung Kan', 'လှေတောင်ကန်',  20, extensions.st_point(96.1820, 16.8395)::extensions.geography),
  ('Saung Thuma',     'စောင့်သုမ',    30, extensions.st_point(96.1610, 16.8330)::extensions.geography),
  ('Thu Mingalar',    'သုမင်္ဂလာ',    40, extensions.st_point(96.1755, 16.8560)::extensions.geography),
  ('Kyaung Kone',     'ကျောင်းကုန်း', 50, extensions.st_point(96.1880, 16.8500)::extensions.geography),
  ('Ngamoeyeik',      'ငမိုးရိပ်',    60, extensions.st_point(96.2050, 16.8620)::extensions.geography),
  ('Thitsar',         'သစ္စာ',       70, extensions.st_point(96.1595, 16.8620)::extensions.geography),
  ('Yadanar',         'ရတနာ',        80, extensions.st_point(96.1930, 16.8280)::extensions.geography)
on conflict (name) do nothing;
```

**2. One super_admin**, via the Admin API — `app_metadata` is the only role
source `tg_on_auth_user_created` trusts, and it is service-role-only:

```bash
curl -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "ops@mingalar.example",
    "password": "CHANGE-ME-NOW",
    "email_confirm": true,
    "app_metadata": { "role": "super_admin" },
    "user_metadata": { "full_name": "Ops" }
  }'
```

**3. Everyone else through the app.** Sign in as that admin and use
`/admin/super/riders` for riders and `/admin/shops` for shops. Both call the
Admin API correctly and set the operating parameters the DB triggers expect —
which is the whole point of having built them.

---

## 6. `npm run db:verify`

Resets a throwaway container, applies all sixteen migrations, seeds, and runs
eight SQL suites (191 assertions). One `ERROR` line in `route_flow` (R4i2) is
deliberate — a commit that must be refused — and is labelled in the output. **Never** point it at anything else (§0).

One-time container setup:

```bash
docker run -d --name mge-verify \
  -e POSTGRES_PASSWORD=verify -e POSTGRES_HOST_AUTH_METHOD=trust \
  -p 55432:5432 ghcr.io/supabase/postgres:17.6.1.158

docker exec -i mge-verify psql -U supabase_admin -d postgres \
  < supabase/tests/00_local_shim.sql
docker exec mge-verify psql -U supabase_admin -d postgres -c \
  "alter table storage.buckets owner to postgres;
   alter table storage.objects owner to postgres;"
```

Then:

```bash
npm run db:verify
```

> **`mge-verify` cannot run the app.** It is a bare Postgres container — port
> 55432, no HTTP listener at all. Supabase's API surface (`/auth/v1`,
> `/rest/v1`, `/storage/v1`) is served by GoTrue, PostgREST and Storage, none of
> which are in that container. `NEXT_PUBLIC_SUPABASE_URL` cannot point at it.
> Use it for SQL verification; use a Supabase stack or Cloud project for
> anything involving the browser.

### The same thing step by step

Useful when a migration fails and you need to see which one. `POSTGRES_PASSWORD`
is `verify`; `trust` applies to in-container connections, so a host connection
still needs it.

```bash
export PGPASSWORD=verify
export MGE_DB="postgresql://postgres@127.0.0.1:55432/postgres"

# 1. reset — this is the destructive part
psql "$MGE_DB" -v ON_ERROR_STOP=1 -q -c "
  drop trigger if exists on_auth_user_created on auth.users;
  do \$\$ declare r record; begin
    for r in select policyname from pg_policies
             where schemaname='storage' and tablename='objects'
    loop execute format('drop policy if exists %I on storage.objects', r.policyname); end loop;
  end \$\$;
  delete from storage.objects; delete from storage.buckets;
  drop schema public cascade; create schema public;
  grant usage on schema public to anon, authenticated, service_role;
  delete from auth.users;"

# 2. all six, in order
for f in supabase/migrations/*.sql; do
  printf '  %-42s' "$(basename "$f")"
  psql "$MGE_DB" -v ON_ERROR_STOP=1 -q -f "$f" && echo OK
done

# 3. seed
psql "$MGE_DB" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql

# 4. confirm
psql "$MGE_DB" -tAc "
select 'tables:      ' || count(*) from pg_tables where schemaname='public'
union all select 'functions:   ' || count(*) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
union all select 'rls enabled: ' || count(*) from pg_tables
  where schemaname='public' and rowsecurity
union all select 'policies:    ' || count(*) from pg_policies where schemaname='public'
union all select 'buckets:     ' || count(*) from storage.buckets
union all select 'wards:       ' || count(*) from public.service_areas
union all select 'auth users:  ' || count(*) from auth.users;"
```

Expected: 11 tables, 41 functions, 11 RLS-enabled, 30 policies, 2 buckets,
8 wards, 6 auth users.

**Verified output on this machine — 82 assertions, 0 failures:**

```
--- apply 20260825090100_init.sql   … through … 20260903090200_return_leg.sql
######  ALL PHASE 1 CHECKS PASSED  ######
####  ALL EDGE CHECKS PASSED  ####
####  ALL STORAGE CHECKS PASSED  ####
####  ALL ASSIGNMENT CHECKS PASSED  ####
####  ALL SETTLEMENT CHECKS PASSED  ####
####  ALL ROUTE / TRIP CHECKS PASSED  ####
####  ALL FAILED-PARCEL CHECKS PASSED  ####
```

Application tests are separate and need no database:

```bash
npm run typecheck   # tsc --noEmit
npm test            # 160 unit tests, node:test
npm run build
```

### Regenerating types

```bash
supabase gen types typescript --linked --schema public > types/database.types.ts
```

`npm run db:types` uses `--local`, which resolves to whichever stack the CLI is
linked to — wrong here while `Main_project` holds the default ports. Use
`--linked` against the Mingalar cloud project instead. Never hand-edit the
generated file.

---

## 7. End-to-end smoke test

```bash
npm run dev     # http://localhost:3000
```

Use three browser profiles (or one normal + two private windows) so three roles
stay signed in at once. Sessions are cookie-based; a second login in the same
profile evicts the first.

### Before you start — the gotcha that wastes the most time

`nearby_available_riders` filters on
`last_ping_at > now() - rider_ping_stale_min` (default **10 minutes**). Seeded
riders are stamped online at seed time, so **the dispatch board looks empty ten
minutes after seeding.** The fix is not to re-seed: sign the rider in and flip
the **Go online** toggle on `/rider/dashboard`, which starts a 20-second
heartbeat.

---

### Step 1 — Shop creates an order

Sign in `shop@mingalar.test` / `mingalar123`.

| # | Action | Expect |
|---|---|---|
| 1.1 | Land after login | `/shop/dashboard` |
| 1.2 | **New order** → `/shop/orders/new` | Pickup pre-filled from the shop's saved point |
| 1.3 | Choose the destination area and drop the dropoff pin | The route and its flat fee appear as soon as the area is chosen |
| 1.4 | Drag the pin **outside** Greater Yangon | Field error: outside the service area. Submit stays blocked |
| 1.5 | Restore a valid pin. Payment **COD**, goods value `25000`, fee payer **customer** | COD to collect = goods + delivery fee |
| 1.6 | Submit | Confirmation modal with the code `MGE-YYMMDD-NNNNNN`, recipient, destination and collectable total. **Create another order** resets the form; **View orders** goes to `/shop/orders` |
| 1.7 | Open `/track/<code>` in a private window | Timeline visible, **no** customer phone, exact address or rider identity |

> **Do not trust the fee shown in the browser.** `createOrder` recomputes it
> server-side from the destination area's route (`routes.per_parcel_fee`). If the
> stored `delivery_fee` differs from the official schedule for that route, that is
> the bug this test exists to find.

### Step 2 — The office plans the run

Stay signed in as `admin@mingalar.test` → `/admin`, which is the run board and
the office's landing page.

> Was "sign in `dispatch@mingalar.test` → `/admin/dispatcher`". The dispatcher
> role was retired on 2026-09-10: it could do nothing a super admin could not,
> and the second login was two things to keep consistent rather than two jobs.
> `/admin/dispatcher` still redirects to `/admin` for old bookmarks.

This is a ROUTE PLANNING board. There is no rider ranking and no offer/accept —
0009 retired both. Work moves by loading parcels onto a scheduled run.

| # | Action | Expect |
|---|---|---|
| 2.1 | Right-hand panel | The new parcel, grouped under its destination area, badged with the route that area maps to |
| 2.2 | Filter to that route | Only its parcels remain; the group header select-all ticks them all at once |
| 2.3 | **New run** on that route | A `planned` trip appears with a grey volume pill reading `0/20 parcels` |
| 2.4 | Choose a rider | A rider already out on another run is listed but **disabled** — the board explains the gap rather than hiding it |
| 2.5 | Tick the parcel, **Load selected** | It leaves the pool and joins the run's manifest, ordered by the route's `stop_order` |
| 2.6 | Watch the volume banner | Amber under 20 parcels, red if the run would actually lose money. It renders nothing when the run is fine |
| 2.7 | **Depart trip** | Under 20 parcels a modal demands a reason of 10+ characters. Cancel it and the run stays; supply one and the override lands in `audit_log` as `trip.depart_below_minimum` with the projected margin |

> **Two tabs, one board.** Every action ends in a server round trip and a
> refresh — nothing is optimistic. Realtime keeps both screens current, so a
> parcel loaded in one tab leaves the pool in the other within ~400 ms. This
> mattered when two dispatchers shared the board and still does for one person
> with it open on a laptop and a phone.

### Step 3 — Rider delivers

Sign in `rider1@mingalar.test` in a third profile → `/rider/dashboard`.
Use device emulation (Chrome DevTools → iPhone/Pixel) — this is a phone UI.

| # | Action | Expect |
|---|---|---|
| 3.1 | Flip **Go online** | Toggle turns green; heartbeat every 20 s |
| 3.2 | Open the manifest | The run's parcels in stop order. There is no offer to accept — a parcel is loaded onto the rider's run at the hub, so it is already theirs |
| 3.3 | Open the job | Pickup address, customer, COD amount to collect |
| 3.4 | **Picked up** | Status → **Picked up**, checkpoint written |
| 3.5 | **Delivered** → camera/file | Photo downscales to WebP before upload |
| 3.6 | Confirm delivery | Status → **Delivered**; `delivered_at` set |
| 3.7 | *(offline check)* DevTools → **Offline**, tap a state change | Queued banner; nothing lost |
| 3.8 | Back **Online** | Queue replays; status advances; **no duplicate** ledger rows |
| 3.9 | `/rider/earnings` | Commission for this job; cash-in-hand = COD collected − commission |

> **The proof photo must upload before the status advances.** The storage policy
> only permits writes while the order is `assigned`/`picked_up`, and
> `orders_delivered_needs_proof` rejects a delivered order with no
> `proof_photo_path`. If 3.5 fails, 3.6 cannot succeed — that is correct.

### Step 4 — Super Admin settles

Sign in `admin@mingalar.test`.

| # | Action | Expect |
|---|---|---|
| 4.1 | `/admin/audit` → **Riders** | Zaw Zaw's open balance = COD collected − commission |
| 4.2 | Switch to **Ledger**, filter *Uncollected (open)* | Exactly **two** lines for the order: `cod_collected` **positive**, `commission_earned` **negative**. That pair is the double entry |
| 4.3 | **Shops** tab | Shop row reconciles: `cod_collected` = goods + fees |
| 4.4 | `/admin/super/settlements`, today's date | Zaw Zaw under **Unsettled balances** |
| 4.5 | *(optional)* `/admin/super/riders` → **Take a cash deposit** | Refuses more than he is holding; headroom recovers by the deposited amount |
| 4.6 | **Build settlements for this day** | A draft appears, status **Drafted** |
| 4.7 | Open it | `collected − commission = net`; the claimed ledger lines listed |
| 4.8 | Back on `/admin/audit` | His open balance is now **0** — cleared when the lines were *claimed*, not when paid |
| 4.9 | **Approve** → **Mark cash received** | **Drafted → Approved → Paid** |
| 4.10 | Try **Reopen** on the paid settlement | Refused. Paid is terminal |
| 4.11 | Correct it instead: `/admin/audit` → **Book an adjustment** | Lands unsettled, sweeps into the next settlement |
| 4.12 | `/admin/super` | KPIs move: delivered today, fees, rider earnings, platform share |

### Step 5 — Shop management

| # | Action | Expect |
|---|---|---|
| 5.1 | `/admin/shops` | Seeded shop **Active**; totals match Step 4 |
| 5.2 | **Suspend** it | Reason required; submit blocked without one |
| 5.3 | Suspend with *unpaid commission* | Shop **Suspended**, owner login blocked |
| 5.4 | In the shop's browser, reload | Bounced to login: "This account has been disabled" |
| 5.5 | Reopen the drawer → **Office notes** | The suspension, its reason, and which admin did it |
| 5.6 | **Activate** | Owner signs in again |

---

## 8. Production deployment

### Vercel

1. Import the repo. Framework preset **Next.js**; build command and output
   directory are the defaults.
2. Pin Node to **20.x or 22.x** in Project Settings → General → Node.js Version.
   Local is v24; do not ship a version you have not built on.
3. Environment variables (Production **and** Preview):

   | Key | Notes |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | |
   | `SUPABASE_SERVICE_ROLE_KEY` | **Secret.** No `NEXT_PUBLIC_` prefix, ever |
   | `NEXT_PUBLIC_MAP_PROVIDER` | `maptiler` |
   | `NEXT_PUBLIC_MAP_API_KEY` | referrer-restricted |
   | `NEXT_PUBLIC_GEOCODER_PROVIDER` | `maptiler` |
   | `NEXT_PUBLIC_GEOCODER_API_KEY` | Optional — falls back to the map key |
   | `NEXT_PUBLIC_GEOCODER_USER_AGENT` | real contact address |
   | `NEXT_PUBLIC_DEFAULT_CENTER_LAT/LNG/ZOOM` | `16.8409` / `96.1735` / `14` |

   Give Preview a **separate Supabase project**. A preview deployment pointed at
   production will let a stray click settle real money.
4. Supabase Dashboard → Authentication → URL Configuration: set **Site URL** to
   the production domain and add both the domain and
   `https://*-<team>.vercel.app` to **Redirect URLs**, or `/auth/callback`
   breaks on preview builds.
5. Deploy, then confirm `/`, `/auth/login` and `/track/ABC` render for a signed-out
   visitor. `lib/env.ts` keeps public routes alive when Supabase is
   misconfigured and fails *closed* on protected ones — if `/admin` renders
   without a login, stop and fix it before going further.

### PWA

The manifest is generated by `app/manifest.ts` at `/manifest.webmanifest`;
`public/sw.js` is registered by `components/shared/service-worker.tsx`.
`next.config.ts` already sends `no-cache` for both, so a stale worker cannot pin
an old build.

- [ ] `/manifest.webmanifest` returns JSON with `start_url: /rider/dashboard`
- [ ] Lighthouse → **Installable** passes on the deployed origin (service
      workers need HTTPS; `localhost` is exempt)
- [ ] Install to an Android home screen, open, kill the network, tap a state
      change — the queued banner appears and the offline page serves
- [x] **192×192 and 512×512 PNG icons.** Done 2026-09-11: the manifest declared
      only a hand-drawn `icon.svg`, which Chrome on Android accepts but older
      Androids and every store wrapper do not, so installability degraded
      silently. Now `/icon-192.png` and `/icon-512.png` from the brand logo
- [ ] **Check the maskable icon on a real launcher.** `/icon-maskable-512.png`
      is the logo inset to 80% because Android crops a maskable icon to a
      circle or squircle — the full-bleed logo loses 11% of its artwork that
      way, including both ends of "MINGALAR". Worth eyeballing on a Samsung
      (squircle) and a Pixel (circle), which crop differently
- [ ] **Check the iOS home screen icon.** `app/apple-icon.png` (180×180) via
      Next's file convention. iOS ignores the manifest icons entirely and has
      never accepted SVG, so before this there was no iOS icon at all —
      Safari fell back to a screenshot of the page
- [ ] Confirm `theme_color` `#c62828` matches the header on a real device

### MapTiler

- [ ] Key created and **restricted by HTTP referrer** to the production domain
- [ ] `NEXT_PUBLIC_MAP_PROVIDER=maptiler` and `NEXT_PUBLIC_MAP_API_KEY` set in
      Vercel
- [ ] **Verify in DevTools → Network that tiles come from `api.maptiler.com`,
      not `tile.openstreetmap.org`.** This is not optional box-ticking: a
      missing or rejected key makes `getMapProvider()` fall back to OSM with
      only a console message, so the map looks correct while quietly running on
      tiles you are not licensed to use at volume
- [ ] `update public.app_settings set map_provider = 'maptiler' where id;` —
      records the choice; the key stays in env
- [ ] Billing alert set. Nothing else caps the spend

Reverse geocoding is a **separate setting** from tiles — set
`NEXT_PUBLIC_GEOCODER_PROVIDER=maptiler` as well, or the pin-to-address lookup
keeps calling public Nominatim while the tiles come from MapTiler.

- [ ] `NEXT_PUBLIC_GEOCODER_PROVIDER=maptiler` set in Vercel
- [ ] Drop a pin on `/shop/orders/new`; the address field autofills and DevTools
      shows a request to `api.maptiler.com/geocoding/{lng},{lat}.json`
- [ ] Console is clean — every `[geocoder]` message is a fallback to public
      Nominatim, which is a misconfiguration, not a warning to ignore

> **`geoapify` is allowed by the database CHECK but has no adapter.** Selecting
> it falls back to Nominatim with a console error. Self-hosted Nominatim needs
> no code change: set `NEXT_PUBLIC_GEOCODER_PROVIDER=self_hosted` and a base
> URL, including one under a sub-path.

### Before real traffic

- [ ] **Replace every `VERIFY-CENTROID` ward centroid** with surveyed points or
      OSM polygons. They are plausible placeholders, not survey data
- [ ] Rotate every seeded credential; delete `*@mingalar.test` accounts from
      production
- [ ] Confirm the `in_service_area()` bbox matches the area you actually serve.
      Widening it is a **migration** — a CHECK constraint cannot read a table.
      The tunable copy is `app_settings.bbox_*` via `/admin/super/areas`, and it
      can only ever be narrowed inside the hard geofence
- [ ] Set the real commission split and fee tiers at `/admin/super/pricing`
- [ ] Enable Supabase **Point-in-Time Recovery**. `cod_ledger` is append-only
      and is the book of record for money owed; there is no other copy
- [ ] Schedule the nightly settlement draft — `build_settlements_for_day()`
      accepts a null-JWT caller via `is_service_ctx()`, so pg_cron can run it
- [ ] Add a Custom Access Token auth hook stamping `role` into `app_metadata`,
      removing one DB round-trip per request in middleware. If you do, note that
      `updateSession` then relies on `app_metadata.suspended` to catch suspended
      accounts — that flag is already written by the shop and rider actions
