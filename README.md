# Mingalar Express

Hyper-local delivery + COD platform for **Thingangyun Township, Yangon**.
Next.js 16 (App Router) · Supabase (Postgres 17 + PostGIS, Auth, Storage) · Tailwind 4 · Leaflet + OpenStreetMap

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Database: [supabase/README.md](supabase/README.md)

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Schema, RLS, dispatch RPCs, storage | **Done** — 46 SQL assertions green |
| 1b | Next scaffold, auth, RBAC middleware, typed DB | **Done** — build + RBAC matrix verified |
| 2 | Shop order intake, Leaflet picker, fee quoting, public tracking | **Done** |
| 3 | Dispatch engine (`/admin/dispatcher`) | **Done** — 63 unit tests, race proven live |
| 4 | Rider PWA + proof of delivery (`/rider`) | **Done** — 85 unit tests, full lifecycle verified live |
| 5 | Commission, COD settlement, Super Admin, shop management | **Done** — 198 unit tests, build green |
| 6 | Route model: scheduled runs, flat route pricing, trip pay, offer engine retired | **Done** — migrations 0007–0010 |
| 7 | Shop panel: real KPIs, proof of delivery, orders workspace + CSV, money page | **Done** — migration 0010 |
| 8 | Failed parcels: shop decides retry / return / cancel, capped auto-retry, return leg | **Done** — migrations 0011–0013 |
| 9 | All-orders screen for the office (`/admin/orders`) | **Done** — every parcel, every shop, every status |
| 9b | Rider/trip integrity: a parcel on a run always names the run's rider | **Done** — migration 0015, found live on staging |
| 10 | Contact log: the office records what was said, and shares `/o/<code>` | **Done** — migration 0017, append-only and dispatch-only |
| 11 | Rider app: Burmese, hub-centred drive order, day counts, one-touch screens | **Done** — migrations 0018–0019 |
| 12 | KBZPay: rider captures the receipt, the office verifies it against the bank | **Done** — migrations 0020–0022. **Needs `public/kpay-qr.png`** |

Every route in the table above now ships. `/admin/super/*` is gated three times over:
middleware (longest-prefix), `requireAdmin` in its layout, and RLS `is_admin()` on every write.

**22 migrations · 191 SQL assertions across eight suites · 363 unit tests.**
`docs/ARCHITECTURE.md` describes the Phase 1–5 design and is partly superseded by
phases 6–9 — it carries a banner saying exactly where. `docs/RUNBOOK.md` is
current.

**There is no automated messaging.** An SMS outbox was built in 0014 and removed
in 0016 in favour of a human loop: the rider phones the office, the office phones
the shop. Three things carry it. `/admin/orders?view=awaiting` lists every parcel
that failed, came off its run, and is waiting on a shop to choose. The **contact
log** on each parcel records what was said, by whom, over which channel —
append-only, dispatch-only. And `/o/<code>` is a short link the office pastes
into Viber. Commit `c501237` has the outbox if the volume ever justifies it.

## Getting started

```bash
npm install
cp .env.example .env.local        # then paste values from `supabase status`

supabase db push                  # applies supabase/migrations/*
psql "$DATABASE_URL" -f supabase/seed.sql   # dev only

npm run dev
```

> **Careful:** `supabase/tests/reset_and_verify.sh` runs `drop schema public cascade`.
> It targets a throwaway container by name and must never be pointed at a database
> you care about.

Seeded accounts (password `mingalar123`): `admin@` / `dispatch@` / `shop@` / `rider1-3@mingalar.test`.

## Scripts

| Command | |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:types` | regenerate `types/database.types.ts` from the live schema |
| `npm test` | unit tests (`node --test`, no extra toolchain) |
| `npm run db:verify` | reset a throwaway DB, migrate, seed, run all SQL suites |

## Layout

```
app/
  auth/{login,register,callback}     sign-in, shop self-signup, magic-link landing
  admin/dispatcher                   dispatch board: queue | map | ranked riders
  admin/super/                       overview KPIs, rider approval, coverage, pricing
  admin/super/settlements/           settlement engine: draft -> approve -> paid
  admin/shops                        shop roster, approval, suspension, onboarding
  admin/audit                        COD audit explorer: riders | shops | ledger
  rider/{dashboard,jobs,earnings}    rider PWA: offers, state engine, proof, earnings
  offline/                           service-worker fallback page
  shop/{dashboard,orders,settings}   shop panel (order intake lives in orders/new)
  track/[code]                       public checkpoint tracking, no auth
  api/orders/quote                   authenticated fee quote
  api/dispatch/candidates            ranked riders for one order
  api/admin/shops/[id]               shop drawer detail (admin only)
components/{ui,map,orders,shared}    primitives, Leaflet, order views
components/admin/                    roster, pricing, coverage, settlement, COD explorer
components/admin/shop-*              shop table, drawer, status dialog, onboarding
lib/
  supabase/{client,server,middleware,admin}
  auth/{guards,actions}              requireRole, isAdmin/isDispatch/isServiceContext
  dispatch/{queries,actions,errors}  queue + fleet, assign/unassign/cancel, error mapping
  rider/{queries,actions,errors}     feed, advance_order/respond_to_offer wrappers
  rider/offline-queue.ts             IndexedDB action queue (photos included)
  rider/use-offline-queue.ts         replay + failure classification
  rider/use-rider-beacon.ts          online toggle, presence, 20s heartbeat
  rider/image.ts                     camera -> WebP downscale
  geo/{haversine,dispatch}           distance + rankRiders scoring (unit tested)
  geo/thingangyun.ts                 the service-area bbox
  map/providers.ts                   pluggable tiles (osm | maptiler | stadia | …)
  map/geocoder.ts                    address search + reverse lookup, one adapter per provider
  orders/actions.ts                  createOrder / cancelOrder server actions
  admin/{queries,actions,errors}     overview, riders, settlements, COD positions
  admin/shop-{queries,actions}       shop roster, status toggles, manual onboarding
  admin/ledger.ts                    ledger_kind labels + the sign convention
  admin/day.ts                       Asia/Yangon business day (mirrors mm_today())
  pricing.ts                         quoteFee, splitCommission, codCollectable
  validation/schemas.ts              zod, mirroring the SQL constraints
  validation/admin.ts                zod for pricing, coverage, riders, adjustments
  validation/admin-shop.ts           zod for shop status, edits, onboarding
types/database.types.ts              GENERATED — do not edit
```

## Rules that are not negotiable

1. **RLS is the security boundary.** Middleware is a UX gate; `requireRole` is a
   second net. Never "fix" a query by reaching for the service-role client.
2. **Money is integer MMK.** No floats, no decimals. The rider's cut is floored
   and the platform takes the remainder, so the split always sums to the fee.
3. **Never trust a fee from the browser.** `createOrder` recomputes it from the
   two map points and `app_settings`.
4. **Leaflet only via `components/map`.** It touches `window` at import time, so
   it must stay behind `dynamic(..., { ssr: false })`.
5. **`app_metadata.role` is the only role source.** It is service-role-writable
   only. `user_metadata` is client-writable and must never decide a role.
6. **Regenerate types, don't hand-edit them.**
7. **Assign only through `assign_order`.** It row-locks the order then the rider,
   so a simultaneous second dispatcher loses loudly. A plain UPDATE would let two
   riders be sent to one parcel. Map its errors with `explainDispatchError` —
   `order_not_assignable` must never be retried.
8. **Rider taps queue before they send.** Every state change is written to
   IndexedDB first (`lib/rider/offline-queue`), so a dead zone cannot lose a
   delivery. Replay safety depends on `advance_order` being idempotent — do not
   "optimise" the status machine's `new.status = old.status` short-circuit away.
9. **Upload the proof BEFORE advancing to `delivered`.** The storage policy only
   permits writes while the order is `assigned`/`picked_up`.
10. **The COD ledger is append-only for everyone, super_admin included.**
   `UPDATE` and `DELETE` are revoked outright, not merely policy-less — a
   policy-less UPDATE matches zero rows and reports *success*. Corrections are
   booked as a reversing `adjustment` line in `/admin/audit`.
11. **A rider's balance clears when `build_settlement` CLAIMS their lines**,
   not when the settlement is approved or paid. Approval and payment track the
   physical cash, which is a separate concern from the book.
12. **The soft bbox in `app_settings` may only be narrowed inside
   `in_service_area()`.** A CHECK constraint cannot read a table, so widening
   the geofence is a migration. A map that accepts a pin the database then
   rejects is the worst failure mode available.
13. **Suspension is `profiles.is_active`, not a UI flag.** `auth_role()` returns
   NULL for an inactive profile, so every role-dependent RLS policy fails.
   `shops.is_active` only stops the shop trading; `app_metadata.suspended` only
   closes the middleware fast path (which trusts `app_metadata.role` and skips
   the `is_active` read). Suspending a shop must not lock an owner out of their
   *other* shops — check for a remaining active one first.
14. **Seeded `auth.users` rows need every token column set to `''`.** A single
   NULL (`reauthentication_token` is the usual one) makes sign-in fail with
   "Database error querying schema" while admin user creation still works.

## Map provider

Development uses raw OpenStreetMap tiles and public Nominatim — no API key, and
**not acceptable for production**: both forbid heavy use and Nominatim caps at
1 request/second. Reverse geocoding is debounced 800 ms and address search
600 ms, both abortable, for that reason.

Note that the identifying User-Agent Nominatim's policy demands is **not sent**:
it is a forbidden header name, so a browser `fetch` drops it. Honouring that
needs a server-side proxy.

Switch with env only, no code change:

```bash
# tiles
NEXT_PUBLIC_MAP_PROVIDER=maptiler        # or stadia | geoapify | self_hosted
NEXT_PUBLIC_MAP_API_KEY=…

# geocoder — SEPARATE setting; setting the tile provider does not move it
NEXT_PUBLIC_GEOCODER_PROVIDER=maptiler   # or nominatim | self_hosted
NEXT_PUBLIC_GEOCODER_API_KEY=…           # falls back to NEXT_PUBLIC_MAP_API_KEY
```

Tiles and geocoding are separate products even from one vendor, so they are
configured independently — MapTiler tiles with a self-hosted Nominatim is a
perfectly normal setup. `lib/map/geocoder.ts` holds one adapter per provider —
Nominatim and MapTiler differ in path, key placement and response shape, and
MapTiler puts coordinates in the URL path as `{lng},{lat}` with longitude first.
`geoapify` is allowed by the database CHECK but has no adapter; selecting it
falls back to Nominatim with a console error.

Address search is restricted to Myanmar and to `THINGANGYUN_SEARCH_BBOX`, which
is deliberately **wider** than the `in_service_area()` geofence: geocoders place
edge-of-township buildings a few hundred metres off, so clipping the search to
the exact geofence would hide them. Candidates landing outside the real geofence
come back flagged and are rendered unselectable rather than silently dropped.

Keys live in env; `app_settings.{map,geocoder}_provider` record only *which*
provider ops chose.
