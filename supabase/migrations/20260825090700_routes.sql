-- ============================================================================
--  MINGALAR EXPRESS  ·  0007 — ROUTE-BASED DELIVERY (Routes A–D)
--
--  The business moves from hyper-local per-order dispatch inside Thingangyun to
--  four scheduled township runs out of Thingangyun Base (သင်္ဃန်းကျွန်း).
--
--    Stop order below is the running order OUT from the base, nearest first.
--
--      Route Local · Grey  · သင်္ဃန်းကျွန်း  all 8 wards, base-to-base
--      Route A · Blue   · Downtown  တာမွေ → မင်္ဂလာတောင်ညွှန့် → ပုဇွန်တောင် → ဗိုလ်တထောင် → ကျောက်တံတား/ဆူးလေ
--      Route B · Green  · West      ရန်ကင်း → ဗဟန်း → ကမရွတ် → လှည်းတန်း
--      Route C · Orange · North     တောင်ဥက္ကလာ → မြောက်ဥက္ကလာ → မင်္ဂလာဒုံ
--      Route D · Red    · East      မြောက်ဒဂုံ → အရှေ့ဒဂုံ → တောင်ဒဂုံ → ဒဂုံဆိပ်ကမ်း
--
--    Thingangyun's wards sit on BOTH Route Local (as their default) and Route A
--    (as non-primary stops), so a local parcel can either wait for a local run
--    or ride out as a bonus drop on the downtown run. That is exactly what the
--    many-to-many route_areas plus the one-primary-per-area index buy.
--
--  What that changes, and why each piece below exists:
--
--    GEOFENCE   Every destination on Routes A–D (ဆူးလေ, ကမာရွတ်, မင်္ဂလာဒုံ,
--               ဒဂုံဆိပ်ကမ်း …) sits OUTSIDE the old Thingangyun box, so no such
--               order could be inserted at all. Widened to Greater Yangon.
--
--    PAY MODEL  A route rider is paid per TRIP, not per parcel:
--                 base(parcel count) + (parcels × 300) + (pickups × 500)
--               `routes.pay_model` stays a per-route column rather than a global
--               flag so a per-parcel route can be added without a migration.
--
--    PRICING    What the SHOP pays becomes a flat per-parcel fee on the route,
--               replacing distance quoting — a ဆူးလေ drop is ~12 km and the
--               per-km fee would price it absurdly.
--
--    CAPACITY   A run carries 20–60 parcels against `max_active_orders <= 10`.
--               Trip-attached orders are excluded from `active_order_count`
--               entirely: the TRIP is the capacity unit (§10).
--
--    COD        The running per-rider float block cannot work when one run holds
--               ~1,000,000 Ks. Replaced by a per-trip ceiling checked once at
--               load time, which is the only moment anyone can act on it.
--
--  NOTE — no local route. All four routes are outbound, so an order dropping
--  INSIDE Thingangyun currently belongs to no route and cannot be loaded onto a
--  trip. Raised with the business; see the gap noted in §11.
--
--  Forward-only. Functions land in 0008; the offer engine is retired in 0009.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. GEOFENCE — widen to Greater Yangon
--
--  Signature is IDENTICAL on purpose. Three CHECK constraints depend on this
--  function (orders.pickup, orders.dropoff, shops.pickup); changing the argument
--  list would break them, while CREATE OR REPLACE keeps them pointing here.
--
--  Postgres does not re-validate existing rows when a function behind a CHECK is
--  replaced. That is safe here only because this WIDENS the box — every row that
--  passed the old bounds passes the new ones. Never narrow it this way.
--
--  Still a typo / wrong-hemisphere guard, not a service-area rule. The tunable
--  copy lives in app_settings.bbox_* and the real route membership in
--  route_areas below.
-- ----------------------------------------------------------------------------

--  Bounds are driven by the extremes of Routes A–D, with padding:
--    south  ကျောက်တံတား/ဗိုလ်တထောင်  ~16.774
--    north  မင်္ဂလာဒုံ                ~17.00   (township runs well north of the airport)
--    west   ကမရွတ်                    ~96.129
--    east   ဒဂုံဆိပ်ကမ်း              ~96.32

create or replace function public.in_service_area(
  p_lat double precision,
  p_lng double precision
) returns boolean
language sql immutable parallel safe
as $$
  select p_lat is not null and p_lng is not null
     and p_lat between 16.7400 and 17.0200   -- S / N  (was 16.7850 .. 16.8950)
     and p_lng between 96.0500 and 96.3400;  -- W / E  (was 96.1350 .. 96.2350)
$$;

comment on function public.in_service_area is
  'Greater Yangon bounding box (16.7400..17.0200 N, 96.0500..96.3400 E). Covers '
  'the base plus every township on Routes A-D. Widened from the Thingangyun-only '
  'box in 0001. Keep lib/geo/thingangyun.ts THINGANGYUN_BBOX in step.';

-- The soft bounds and the map home view move with it, or the pickers keep
-- rejecting pins the database now accepts.
update public.app_settings set
    bbox_south = 16.7400,
    bbox_north = 17.0200,
    bbox_west  = 96.0500,
    bbox_east  = 96.3400,
    map_default_zoom = 11          -- z14 covered one township; the area is now city-wide
  where id;


-- ----------------------------------------------------------------------------
-- 2. ENUMS
-- ----------------------------------------------------------------------------

create type public.trip_status as enum (
  'planned',    -- created for a route + date, no parcels yet
  'loading',    -- parcels being attached at the hub
  'departed',   -- rider has left စံပြစျေး
  'returned',   -- rider back at the hub, pay not yet booked
  'closed',     -- pay snapshotted and booked to the ledger. terminal.
  'cancelled'
);

comment on type public.trip_status is
  'planned -> loading -> departed -> returned -> closed. `closed` is terminal: '
  'the trip_pay ledger line is written on close, and cod_ledger is append-only, '
  'so a correction is a new adjustment line, never a re-close.';

-- Trip pay is a fourth thing the platform can owe a rider.
--
-- ALTER TYPE ... ADD VALUE must not run in the same transaction that USES the
-- value. `psql -f` is autocommit, so each statement is its own transaction and
-- this is fine — but never wrap this migration in BEGIN/COMMIT. The value is
-- first used in 0008.
alter type public.ledger_kind add value if not exists 'trip_pay';


-- ----------------------------------------------------------------------------
-- 3. TABLE — routes  (the five Ways)
--
--  A table, not an enum: Ways get renamed, repriced and added without a
--  migration. Same reasoning as service_areas in 0001.
-- ----------------------------------------------------------------------------

create table public.routes (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique check (code ~ '^[A-Z0-9_]{3,20}$'),
  name                 text not null check (length(trim(name)) between 1 and 120),
  name_mm              text,

  -- Operations identify routes by colour on the printed map and on the board, so
  -- the colour is data, not a UI constant. Stored as a hex literal rather than a
  -- token name so a manifest can be printed without the app's stylesheet.
  colour               text not null default '#71717a'
                         check (colour ~ '^#[0-9a-fA-F]{6}$'),

  -- Hub the run departs from. Per-route rather than global so a second hub does
  -- not need a schema change.
  hub_lat              double precision not null,
  hub_lng              double precision not null,
  hub_geog             extensions.geography(Point,4326)
                       generated always as (
                         extensions.st_setsrid(
                           extensions.st_makepoint(hub_lng, hub_lat), 4326
                         )::extensions.geography
                       ) stored,

  -- 'trip'        : base + per-parcel + per-pickup, booked once on close (Ways ၁–၄)
  -- 'per_parcel'  : the existing commission split per order (Way ၀, local)
  pay_model            text not null default 'trip'
                         check (pay_model in ('trip','per_parcel')),

  -- What the SHOP pays per parcel on this route. Flat, not distance-based.
  per_parcel_fee       bigint not null check (per_parcel_fee >= 0),

  -- Loading ceilings, enforced by load_trip() in 0008. Deliberately separate
  -- from the pay tiers: "how many may we load" is an operational limit, while
  -- "how much do we pay" is a commercial one, and they move independently.
  max_parcels_per_trip smallint not null default 60 check (max_parcels_per_trip between 1 and 500),
  max_cod_per_trip     bigint   not null default 2000000 check (max_cod_per_trip >= 0),

  sort_order           smallint not null default 100,
  is_active            boolean  not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint routes_hub_in_service_area check (public.in_service_area(hub_lat, hub_lng))
);

create index routes_active_idx on public.routes (sort_order, code) where is_active;

create trigger routes_touch before update on public.routes
for each row execute function public.tg_touch_updated_at();

comment on column public.routes.pay_model is
  'trip = base + per-parcel + per-pickup booked once on close. per_parcel = the '
  'commission split snapshotted per order at assignment (Way 0 / local only).';


-- ----------------------------------------------------------------------------
-- 4. TABLE — route_areas  (which townships a route serves, in stop order)
--
--  Under the current four-route map every township belongs to exactly one route,
--  so a plain route_id on service_areas would fit. It is still many-to-many for
--  two reasons: `stop_order` is a property of the PAIR, not of the township (the
--  same township can sit at a different position on a second route), and an
--  earlier draft of this map already had တောင်ဒဂုံ on two routes — that will
--  recur, and a join table absorbs it without a migration.
-- ----------------------------------------------------------------------------

-- service_areas now holds two kinds of thing: the eight Thingangyun WARDS seeded
-- in 0001 (local geography, used for shop/dropoff grouping) and the TOWNSHIPS
-- that Routes A-D serve. Without this column the two are indistinguishable and
-- somebody eventually assigns a Thingangyun ward to Route A.
alter table public.service_areas
  add column kind text not null default 'ward' check (kind in ('ward','township'));

comment on column public.service_areas.kind is
  'ward = a Thingangyun sub-area, served by Route Local (and by Route A as a '
  'bonus drop). township = a Greater Yangon township served by one outbound '
  'route. Both kinds appear in route_areas; the column exists so a report can '
  'tell local volume from outbound volume.';

create table public.route_areas (
  route_id   uuid not null references public.routes(id) on delete cascade,
  area_id    uuid not null references public.service_areas(id) on delete cascade,
  stop_order smallint not null default 100,
  -- The Way a parcel for this township goes on by DEFAULT. A dispatcher may
  -- still load it onto any other Way that serves the township.
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (route_id, area_id)
);

-- Exactly one default Way per township, while still allowing the township to
-- appear on several. Same partial-unique trick as profiles_phone_key in 0001.
create unique index route_areas_primary_uk on public.route_areas (area_id)
  where is_primary;

create index route_areas_route_idx on public.route_areas (route_id, stop_order);

comment on column public.route_areas.stop_order is
  'Sequence along the run. Doubles as the rider manifest ordering, so a '
  'dispatcher reordering stops reorders the rider''s list.';


-- ----------------------------------------------------------------------------
-- 5. TABLE — route_pay_tiers  (base pay by parcel count)
--
--  Rows, not constants, because the source spec contradicted itself at the tier
--  boundary ("အနည်းဆုံး ၂၀ ထုပ် → ၁၅,၀၀၀" vs "၂၀ မှ ၄၀ → ၂၀,၀၀၀"). Ops must be
--  able to correct that in the admin panel without shipping a migration.
-- ----------------------------------------------------------------------------

-- Needed for `uuid WITH =` inside a GiST exclusion constraint: core GiST has no
-- equality operator class for uuid. Installed into `extensions` like pgcrypto
-- and postgis, and the opclass is schema-qualified below because constraint
-- definitions are resolved at DDL time and ignore search_path.
create extension if not exists "btree_gist" with schema extensions;

create table public.route_pay_tiers (
  id           uuid primary key default gen_random_uuid(),

  -- NULL = a global default, applying to every trip-paid route. A row naming a
  -- route OVERRIDES the global tier covering the same parcel count, so local
  -- economics can diverge later without a special case in close_trip().
  route_id     uuid references public.routes(id) on delete cascade,

  min_parcels  integer not null check (min_parcels >= 0),
  -- NULL = open-ended. The top tier is left open so an unusually heavy run still
  -- resolves to a base rate instead of failing mid-close; the 60-parcel figure
  -- from the spec is enforced by routes.max_parcels_per_trip instead.
  max_parcels  integer check (max_parcels is null or max_parcels >= min_parcels),
  base_pay     bigint  not null check (base_pay >= 0),
  created_at   timestamptz not null default now(),

  -- Overlapping tiers would make quote_trip_pay() ambiguous — two different
  -- answers for the same parcel count, depending on plan order. Range exclusion
  -- makes that unrepresentable rather than merely discouraged.
  --
  -- Scoped per route, and route_id is COALESCED to a sentinel rather than
  -- compared raw: an exclusion constraint treats a NULL operand as "no
  -- conflict", so a bare `route_id WITH =` would let two overlapping GLOBAL
  -- tiers coexist -- silently removing the protection from the only rows that
  -- ship today. The sentinel makes NULLs compare equal to each other while
  -- still never colliding with a real route id.
  --
  -- A route-specific tier is DELIBERATELY allowed to overlap a global one; that
  -- overlap is what "override" means, and quote_trip_pay() resolves it by
  -- preferring the route-specific row.
  constraint route_pay_tiers_no_overlap
    exclude using gist (
      coalesce(route_id, '00000000-0000-0000-0000-000000000000'::uuid)
        extensions.gist_uuid_ops with =,
      int4range(min_parcels, coalesce(max_parcels + 1, 2147483647)) with &&
    )
);

create index route_pay_tiers_route_idx on public.route_pay_tiers (route_id)
  where route_id is not null;

comment on table public.route_pay_tiers is
  'Base trip pay by parcel count. route_id NULL = global default; a row naming a '
  'route overrides the global tier for that route. Ranges must not overlap '
  'within the same scope (enforced). Per-parcel and per-pickup rates live in '
  'app_settings.';
comment on column public.route_pay_tiers.route_id is
  'NULL = applies to every trip-paid route. Set to override pay for one route, '
  'e.g. if ROUTE_LOCAL short runs should not earn the full 15,000 base.';


-- ----------------------------------------------------------------------------
-- 6. app_settings — the two per-unit rates
-- ----------------------------------------------------------------------------

alter table public.app_settings
  add column route_parcel_rate bigint not null default 300 check (route_parcel_rate >= 0),
  add column route_pickup_rate bigint not null default 500 check (route_pickup_rate >= 0);

comment on column public.app_settings.route_parcel_rate is
  'Added per parcel on a trip-paid route, on top of the tier base. Applies to '
  'EVERY parcel, not only those above the tier floor.';
comment on column public.app_settings.route_pickup_rate is
  'Added per parcel COLLECTED on the return leg (orders.trip_leg = ''pickup'').';


-- ----------------------------------------------------------------------------
-- 7. TABLE — trips  (the unit of work, and of pay)
-- ----------------------------------------------------------------------------

create table public.trips (
  id              uuid primary key default gen_random_uuid(),
  route_id        uuid not null references public.routes(id) on delete restrict,
  rider_id        uuid references public.rider_profiles(id) on delete set null,
  service_date    date not null,
  status          public.trip_status not null default 'planned',

  departed_at     timestamptz,
  returned_at     timestamptz,
  closed_at       timestamptz,

  -- SNAPSHOTTED on close, never recomputed. Same reasoning as
  -- orders.rider_commission_pct (decision D5): repricing the tiers next month
  -- must not rewrite last month's settlements.
  parcel_count    integer not null default 0 check (parcel_count >= 0),
  pickup_count    integer not null default 0 check (pickup_count >= 0),
  base_pay        bigint  not null default 0 check (base_pay >= 0),
  parcel_pay      bigint  not null default 0 check (parcel_pay >= 0),
  pickup_pay      bigint  not null default 0 check (pickup_pay >= 0),
  total_pay       bigint  not null default 0 check (total_pay >= 0),
  pay_tier_snapshot jsonb,

  notes           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint trips_pay_sums check (total_pay = base_pay + parcel_pay + pickup_pay),
  constraint trips_closed_has_rider check (status <> 'closed' or rider_id is not null)
);

-- Deliberately NOT unique on (route_id, service_date): a heavy day may need a
-- second run on the same Way.
create index trips_route_date_idx on public.trips (route_id, service_date desc);
create index trips_rider_idx      on public.trips (rider_id, service_date desc);
create index trips_open_idx       on public.trips (status, service_date)
  where status in ('planned','loading','departed');

-- A rider cannot be out on two runs at once.
create unique index trips_rider_open_uk on public.trips (rider_id)
  where rider_id is not null and status in ('planned','loading','departed');

create trigger trips_touch before update on public.trips
for each row execute function public.tg_touch_updated_at();


-- ----------------------------------------------------------------------------
-- 8. orders — trip attachment
-- ----------------------------------------------------------------------------

alter table public.orders
  add column trip_id  uuid references public.trips(id) on delete set null,
  -- 'delivery' : carried out from the hub and dropped (paid route_parcel_rate)
  -- 'pickup'   : collected on the return leg  (paid route_pickup_rate)
  add column trip_leg text check (trip_leg in ('delivery','pickup'));

create index orders_trip_idx on public.orders (trip_id) where trip_id is not null;
-- The planning board's main query: parcels not yet on a run.
create index orders_unrouted_idx on public.orders (dropoff_area_id, created_at)
  where trip_id is null and status = 'pending';

comment on column public.orders.trip_id is
  'Set by load_trip(). A trip-attached order is EXCLUDED from '
  'rider_profiles.active_order_count — the trip is the capacity unit.';


-- ----------------------------------------------------------------------------
-- 9. RLS
--     Reference data reads wide, writes admin-only. Same shape as 0003.
-- ----------------------------------------------------------------------------

alter table public.routes          enable row level security;
alter table public.route_areas     enable row level security;
alter table public.route_pay_tiers enable row level security;
alter table public.trips           enable row level security;

create policy routes_read_all on public.routes
  for select to authenticated using (true);
create policy routes_write_admin on public.routes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy route_areas_read_all on public.route_areas
  for select to authenticated using (true);
create policy route_areas_write_admin on public.route_areas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Riders need to read the tiers to see how a run's pay was reached.
create policy tiers_read_all on public.route_pay_tiers
  for select to authenticated using (true);
create policy tiers_write_admin on public.route_pay_tiers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- A rider sees their own runs and nobody else's.
create policy trips_read_own_or_dispatch on public.trips
  for select to authenticated
  using (rider_id = auth.uid() or public.is_dispatch());

create policy trips_write_dispatch on public.trips
  for all to authenticated
  using (public.is_dispatch()) with check (public.is_dispatch());

-- Trips are cancelled, never deleted -- the pay snapshot and its ledger line
-- must outlive the run.
revoke delete on public.trips from authenticated;


-- ----------------------------------------------------------------------------
-- 10. CAPACITY — exclude trip orders from active_order_count
--
--  A run carries 20–60 parcels; `max_active_orders` is CHECKed at 1..10. Rather
--  than inflating that ceiling (which would also let the OFFER path hand a
--  single rider 60 ad-hoc parcels), trip-attached orders are simply not counted:
--  load_trip() never increments, so this release must never decrement, or the
--  counter walks negative and `riders_capacity_sane` starts rejecting updates.
--
--  Only §5b changes. The rest is copied verbatim from 0002 so the whole trigger
--  body stays readable in one place.
-- ----------------------------------------------------------------------------

create or replace function public.tg_orders_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lat  double precision := nullif(current_setting('app.event_lat',  true), '')::double precision;
  v_lng  double precision := nullif(current_setting('app.event_lng',  true), '')::double precision;
  v_note text            := nullif(current_setting('app.event_note', true), '');
begin
  -- 5a. checkpoint trail -----------------------------------------------------
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_status_events
      (order_id, from_status, to_status, actor_id, actor_role, lat, lng, note)
    values
      (new.id,
       case when tg_op = 'UPDATE' then old.status end,
       new.status,
       auth.uid(),
       public.auth_role(),
       v_lat, v_lng,
       coalesce(v_note, new.fail_reason, new.cancel_reason));
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  -- 5b. release rider capacity ---------------------------------------------
  -- Covers completion, failure, cancellation, unassignment and hand-over.
  -- `old.trip_id is null` is the route-model guard: load_trip() never took a
  -- capacity slot, so releasing one here would drive the counter negative.
  if old.rider_id is not null
     and old.trip_id is null
     and old.status in ('assigned','picked_up')
     and (new.status in ('delivered','failed','cancelled','pending')
          or new.rider_id is distinct from old.rider_id) then
    perform set_config('app.rider_guard_bypass', 'on', true);
    update public.rider_profiles
       set active_order_count = greatest(active_order_count - 1, 0),
           availability       = 'available'
     where id = old.rider_id;
    perform set_config('app.rider_guard_bypass', 'off', true);
  end if;

  -- 5c. COD ledger on delivery ---------------------------------------------
  -- Two lines, always in this order:
  --   + cod_amount              (rider now holds the platform's cash)
  --   - rider_commission_amount (platform now owes the rider their cut)
  -- Prepaid deliveries produce only the negative line -- the rider still earns.
  --
  -- Route orders leave the commission columns NULL, so the guard below skips
  -- them and they book only the cash line. Their pay arrives once per run as a
  -- single 'trip_pay' line from close_trip(). No branch on trip_id needed.
  if new.status = 'delivered' and old.status <> 'delivered' and new.rider_id is not null then
    if new.payment_method = 'cod' and new.cod_amount > 0 then
      insert into public.cod_ledger (order_id, rider_id, kind, amount, created_by, memo)
      values (new.id, new.rider_id, 'cod_collected', new.cod_amount,
              coalesce(auth.uid(), new.rider_id), new.code)
      on conflict do nothing;
    end if;

    if coalesce(new.rider_commission_amount, 0) > 0 then
      insert into public.cod_ledger (order_id, rider_id, kind, amount, created_by, memo)
      values (new.id, new.rider_id, 'commission_earned', -new.rider_commission_amount,
              coalesce(auth.uid(), new.rider_id), new.code)
      on conflict do nothing;
    end if;
  end if;

  return new;
end $$;


-- ----------------------------------------------------------------------------
-- 11. SEED — the five Ways and the default pay tiers
--
--  System configuration, not test data, so it ships with the schema. The
--  township list and stop order live in seed.sql, because they are geography
--  that ops edits (and every centroid there is still VERIFY-CENTROID work).
-- ----------------------------------------------------------------------------

-- Thingangyun Base (စံပြဈေး) — the hub every route departs from.
--
-- per_parcel_fee is the OFFICIAL schedule signed off by the business: what a
-- shop pays per parcel on that route. Mirrored in lib/pricing.ts as
-- OFFICIAL_ROUTE_FEES and asserted by pricing.test.ts, so the two cannot drift
-- silently.
--
-- ROUTE_LOCAL closes the gap the four outbound routes left: a parcel that both
-- starts and ends inside Thingangyun belongs to no outbound route, so without
-- this it could never be loaded onto a trip at all. Its wards are also mapped
-- onto Route A as non-primary stops, which is what lets a local parcel ride out
-- as a bonus drop instead of waiting for a local run (see seed.sql).
insert into public.routes
  (code, name, name_mm, colour, hub_lat, hub_lng, pay_model, per_parcel_fee, sort_order)
values
  ('ROUTE_LOCAL', 'Route Local — Thingangyun', 'သင်္ဃန်းကျွန်းတွင်းပိုင်း',
   '#71717a', 16.8478, 96.1693, 'trip', 2500,  0),   -- Grey
  ('ROUTE_A',     'Route A — Downtown',        'ဆူးလေ လမ်းကြောင်း',
   '#1d4ed8', 16.8478, 96.1693, 'trip', 3500, 10),   -- Blue
  ('ROUTE_B',     'Route B — West',            'လှည်းတန်း / အနောက်ဘက်',
   '#15803d', 16.8478, 96.1693, 'trip', 3500, 20),   -- Green
  ('ROUTE_C',     'Route C — North',           'မြောက်ဥက္ကလာ / အရှေ့မြောက်ဘက်',
   '#c2410c', 16.8478, 96.1693, 'trip', 4000, 30),   -- Orange
  ('ROUTE_D',     'Route D — East',            'မြောက်ဒဂုံ / အရှေ့ဘက်',
   '#c62828', 16.8478, 96.1693, 'trip', 4000, 40)    -- Red
on conflict (code) do update
  set per_parcel_fee = excluded.per_parcel_fee,
      colour         = excluded.colour,
      name           = excluded.name,
      name_mm        = excluded.name_mm,
      sort_order     = excluded.sort_order;

-- ROUTE_LOCAL is trip-paid like the rest, because the business described "daily
-- local hub trips". That has a consequence worth watching: the pay tiers are
-- GLOBAL, so a short local run earns the same 15,000 base as a run to ဒဂုံဆိပ်ကမ်း.
-- At 2,500 Ks a local run only breaks even around SEVEN parcels and loses money
-- below that (see breakEvenParcels() in lib/pricing.ts). If local economics need
-- to diverge, the fix is a route_id column on route_pay_tiers, not a special
-- case in close_trip().

-- Boundaries resolve DOWNWARD, so 20 parcels lands in the 20,000 tier and pays
-- 20,000 + (20 × 300) = 26,000. The source spec also said "at least 20 →
-- 15,000", which contradicts that; 15,000 is treated as the sub-20 rate. Change
-- these rows, not this comment, if that reading is wrong.
-- route_id omitted, so these are the GLOBAL defaults every trip-paid route uses.
insert into public.route_pay_tiers (route_id, min_parcels, max_parcels, base_pay) values
  (null,  0, 19,   15000),
  (null, 20, 39,   20000),
  (null, 40, null, 25000)
on conflict do nothing;


-- ----------------------------------------------------------------------------
-- 12. GRANTS
--     RLS above is the boundary; these are the privileges it filters.
-- ----------------------------------------------------------------------------

grant select, insert, update, delete on public.routes          to authenticated;
grant select, insert, update, delete on public.route_areas     to authenticated;
grant select, insert, update, delete on public.route_pay_tiers to authenticated;
grant select, insert, update         on public.trips           to authenticated;
grant all on public.routes, public.route_areas,
             public.route_pay_tiers, public.trips to service_role;

revoke all on public.routes, public.route_areas,
              public.route_pay_tiers, public.trips from anon;
