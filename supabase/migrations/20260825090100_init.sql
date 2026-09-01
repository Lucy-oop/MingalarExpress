-- ============================================================================
--  MINGALAR EXPRESS  ·  0001 — INIT
--  Extensions, enums, 11 tables, constraints, indexes.
--  Forward-only migration. Local iteration: `supabase db reset`.
--
--  Conventions enforced throughout:
--    * Money  : bigint, whole MMK. No numeric, no float, ever.
--    * Geo    : lat/lng as double precision (forms/Leaflet) + a GENERATED
--               STORED geography column (GiST index). Cannot desync.
--    * Time   : timestamptz everywhere. Business days are Asia/Yangon (UTC+6:30)
--               and resolved via public.mm_day_bounds().
--    * Ledger : cod_ledger is append-only. Sign convention documented below.
-- ============================================================================

set check_function_bodies = off;

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "postgis"  with schema extensions;

-- PostGIS lives in `extensions`, not `public`. GENERATED column expressions are
-- resolved at DDL time and ignore search_path, so every PostGIS call below is
-- schema-qualified. Do not "simplify" those away.


-- ----------------------------------------------------------------------------
-- 1. ENUMS (8)
-- ----------------------------------------------------------------------------

create type public.user_role          as enum ('super_admin','dispatcher','shop_owner','rider');
create type public.order_status       as enum ('pending','assigned','picked_up','delivered','failed','cancelled');
create type public.rider_availability as enum ('available','busy');
create type public.payment_method     as enum ('cod','prepaid');
create type public.cod_status         as enum ('none','pending','collected','remitted','settled');
create type public.settlement_status  as enum ('open','submitted','approved','paid');
create type public.offer_response     as enum ('pending','accepted','rejected','expired');
create type public.ledger_kind        as enum ('cod_collected','cod_remitted','commission_earned','platform_fee','adjustment');

comment on type public.ledger_kind is
  'cod_ledger.amount sign convention: POSITIVE = rider owes the platform '
  '(cash collected from a customer). NEGATIVE = platform owes the rider '
  '(commission earned, cash already remitted). A rider''s live cash position is '
  'sum(amount) where settlement_id is null.';


-- ----------------------------------------------------------------------------
-- 2. SHARED IMMUTABLE HELPERS
--    Referenced from CHECK constraints, so they must be IMMUTABLE.
-- ----------------------------------------------------------------------------

-- Hard geofence for Thingangyun Township, Yangon.
-- Standard township bbox + ~1km buffer. This is a typo/wrong-hemisphere guard,
-- not a business rule -- the precise ward boundary lives in
-- service_areas.boundary and is validated in the application layer.
-- Widening this bbox requires a migration (CHECK constraints cannot read tables).
create or replace function public.in_service_area(
  p_lat double precision,
  p_lng double precision
) returns boolean
language sql immutable parallel safe
as $$
  select p_lat is not null and p_lng is not null
     and p_lat between 16.7850 and 16.8950   -- S / N
     and p_lng between 96.1350 and 96.2350;  -- W / E
$$;

comment on function public.in_service_area is
  'Thingangyun Township bounding box (16.7850..16.8950 N, 96.1350..96.2350 E).';

-- Business-day boundaries in Myanmar time. A "25 Aug" settlement must cover
-- 25 Aug 00:00 -> 26 Aug 00:00 *Yangon*, which is 24 Aug 17:30 -> 25 Aug 17:30 UTC.
create or replace function public.mm_day_start(p_date date)
returns timestamptz language sql immutable parallel safe
as $$ select p_date::timestamp at time zone 'Asia/Yangon' $$;

create or replace function public.mm_day_end(p_date date)
returns timestamptz language sql immutable parallel safe
as $$ select (p_date + 1)::timestamp at time zone 'Asia/Yangon' $$;

create or replace function public.mm_today()
returns date language sql stable parallel safe
as $$ select (now() at time zone 'Asia/Yangon')::date $$;

-- Generic updated_at toucher.
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;


-- ----------------------------------------------------------------------------
-- 3. TABLE 1/11 — profiles  (mirror of auth.users + role)
-- ----------------------------------------------------------------------------

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  role            public.user_role not null,
  full_name       text not null check (length(trim(full_name)) between 1 and 120),
  -- Nullable on purpose: the auth signup trigger has no phone to insert, and a
  -- fabricated placeholder would collide with the unique index. The application
  -- requires a phone before a shop can create orders or a rider can go online.
  phone           text check (phone ~ '^\+959[0-9]{7,9}$'),
  preferred_lang  text not null default 'my' check (preferred_lang in ('my','en')),
  avatar_path     text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index profiles_phone_key on public.profiles (phone) where phone is not null;
create index profiles_role_idx on public.profiles (role) where is_active;

comment on column public.profiles.phone is 'E.164 Myanmar mobile, e.g. +9597xxxxxxx.';


-- ----------------------------------------------------------------------------
-- 4. TABLE 2/11 — service_areas  (Thingangyun wards)
--    A table, not an enum: wards get renamed and added without a migration.
-- ----------------------------------------------------------------------------

create table public.service_areas (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) > 0),
  name_mm     text,
  centroid    extensions.geography(Point,4326),
  boundary    extensions.geography(Polygon,4326),
  sort_order  smallint not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index service_areas_boundary_gix on public.service_areas using gist (boundary);
create index service_areas_active_idx    on public.service_areas (sort_order, name) where is_active;


-- ----------------------------------------------------------------------------
-- 5. TABLE 3/11 — shops
-- ----------------------------------------------------------------------------

create table public.shops (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles(id) on delete restrict,
  name            text not null check (length(trim(name)) between 1 and 160),
  phone           text not null check (phone ~ '^\+959[0-9]{7,9}$'),
  area_id         uuid references public.service_areas(id) on delete set null,

  pickup_address  text not null check (length(trim(pickup_address)) > 0),
  pickup_lat      double precision not null check (pickup_lat between -90  and 90),
  pickup_lng      double precision not null check (pickup_lng between -180 and 180),
  pickup_geog     extensions.geography(Point,4326)
                  generated always as (
                    extensions.st_setsrid(
                      extensions.st_makepoint(pickup_lng, pickup_lat), 4326
                    )::extensions.geography
                  ) stored,
  pickup_note     text,

  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint shops_pickup_in_service_area
    check (public.in_service_area(pickup_lat, pickup_lng))
);

create index shops_owner_idx  on public.shops (owner_id);
create index shops_area_idx   on public.shops (area_id);
create index shops_pickup_gix on public.shops using gist (pickup_geog);

create trigger shops_touch before update on public.shops
for each row execute function public.tg_touch_updated_at();


-- ----------------------------------------------------------------------------
-- 6. TABLE 4/11 — rider_profiles
-- ----------------------------------------------------------------------------

create table public.rider_profiles (
  id                      uuid primary key references public.profiles(id) on delete cascade,
  base_area_id            uuid references public.service_areas(id) on delete set null,
  coverage_km             numeric(4,1) not null default 5.0 check (coverage_km between 0.5 and 30.0),

  is_online               boolean not null default false,
  availability            public.rider_availability not null default 'available',

  current_lat             double precision check (current_lat between -90  and 90),
  current_lng             double precision check (current_lng between -180 and 180),
  current_geog            extensions.geography(Point,4326)
                          generated always as (
                            case when current_lat is null or current_lng is null then null
                            else extensions.st_setsrid(
                                   extensions.st_makepoint(current_lng, current_lat), 4326
                                 )::extensions.geography
                            end
                          ) stored,
  last_ping_at            timestamptz,

  vehicle_plate           text,
  nrc_no                  text,
  emergency_contact       text,

  commission_pct_override numeric(5,2) check (commission_pct_override between 0 and 100),
  max_active_orders       smallint not null default 3 check (max_active_orders between 1 and 10),
  active_order_count      smallint not null default 0 check (active_order_count >= 0),
  cod_float_limit         bigint   not null default 500000 check (cod_float_limit >= 0),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint riders_coords_paired
    check ((current_lat is null) = (current_lng is null)),
  constraint riders_capacity_sane
    check (active_order_count <= max_active_orders)
);

-- THE dispatch hot path. Partial GiST: only online+free riders are ever scanned.
create index riders_dispatch_gix on public.rider_profiles using gist (current_geog)
  where is_online and availability = 'available';
create index riders_area_idx on public.rider_profiles (base_area_id) where is_online;
create index riders_ping_idx on public.rider_profiles (last_ping_at desc) where is_online;

create trigger riders_touch before update on public.rider_profiles
for each row execute function public.tg_touch_updated_at();

comment on column public.rider_profiles.cod_float_limit is
  'Max unsettled cash (MMK) a rider may carry before dispatch stops offering COD jobs.';


-- ----------------------------------------------------------------------------
-- 7. TABLE 5/11 — orders
--    Pickup/dropoff are SNAPSHOTS, not joins: a shop editing its address must
--    never rewrite delivery history.
-- ----------------------------------------------------------------------------

create sequence public.order_seq;

create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique default
                       'MGE-' || to_char(now() at time zone 'Asia/Yangon', 'YYMMDD')
                       || '-' || lpad(nextval('public.order_seq')::text, 6, '0'),

  shop_id            uuid not null references public.shops(id) on delete restrict,
  rider_id           uuid references public.rider_profiles(id) on delete set null,
  status             public.order_status not null default 'pending',

  -- pickup snapshot ---------------------------------------------------------
  pickup_address     text not null check (length(trim(pickup_address)) > 0),
  pickup_lat         double precision not null,
  pickup_lng         double precision not null,
  pickup_geog        extensions.geography(Point,4326)
                     generated always as (
                       extensions.st_setsrid(
                         extensions.st_makepoint(pickup_lng, pickup_lat), 4326
                       )::extensions.geography
                     ) stored,
  pickup_contact     text,
  pickup_note        text,

  -- customer / dropoff ------------------------------------------------------
  customer_name      text not null check (length(trim(customer_name)) between 1 and 160),
  customer_phone     text not null check (customer_phone ~ '^\+959[0-9]{7,9}$'),
  customer_phone_alt text check (customer_phone_alt is null or customer_phone_alt ~ '^\+959[0-9]{7,9}$'),
  dropoff_address    text not null check (length(trim(dropoff_address)) > 0),
  dropoff_area_id    uuid references public.service_areas(id) on delete set null,
  dropoff_lat        double precision not null,
  dropoff_lng        double precision not null,
  dropoff_geog       extensions.geography(Point,4326)
                     generated always as (
                       extensions.st_setsrid(
                         extensions.st_makepoint(dropoff_lng, dropoff_lat), 4326
                       )::extensions.geography
                     ) stored,
  dropoff_note       text,   -- 'blue gate, 2nd floor, ring twice'

  -- parcel ------------------------------------------------------------------
  parcel_desc        text not null check (length(trim(parcel_desc)) between 1 and 500),
  parcel_weight_g    integer check (parcel_weight_g between 0 and 50000),
  parcel_value       bigint check (parcel_value >= 0),
  is_fragile         boolean not null default false,

  -- money · whole MMK -------------------------------------------------------
  payment_method     public.payment_method not null default 'cod',
  cod_amount         bigint not null default 0 check (cod_amount >= 0),
  delivery_fee       bigint not null check (delivery_fee >= 0),
  fee_payer          text   not null default 'customer' check (fee_payer in ('customer','shop')),
  cod_status         public.cod_status not null default 'none',
  rider_commission_pct    numeric(5,2) check (rider_commission_pct between 0 and 100),
  rider_commission_amount bigint check (rider_commission_amount >= 0),
  platform_fee_amount     bigint check (platform_fee_amount >= 0),

  -- ops ---------------------------------------------------------------------
  route_distance_km  numeric(6,2) check (route_distance_km >= 0),
  assign_distance_km numeric(6,2) check (assign_distance_km >= 0),
  assigned_at        timestamptz,
  assigned_by        uuid references public.profiles(id) on delete set null,
  picked_up_at       timestamptz,
  delivered_at       timestamptz,
  closed_at          timestamptz,
  fail_reason        text,
  cancel_reason      text,
  proof_photo_path   text,
  proof_receiver     text,

  created_by         uuid not null references public.profiles(id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- invariants --------------------------------------------------------------
  constraint orders_cod_consistent check (
    (payment_method = 'cod'     and cod_amount > 0) or
    (payment_method = 'prepaid' and cod_amount = 0)
  ),
  constraint orders_delivered_needs_proof check (
    status <> 'delivered' or proof_photo_path is not null
  ),
  constraint orders_assigned_needs_rider check (
    status = 'pending' or status = 'cancelled' or rider_id is not null
  ),
  constraint orders_pickup_in_service_area
    check (public.in_service_area(pickup_lat, pickup_lng)),
  constraint orders_dropoff_in_service_area
    check (public.in_service_area(dropoff_lat, dropoff_lng)),
  constraint orders_commission_split_sane check (
    rider_commission_amount is null or platform_fee_amount is null
    or rider_commission_amount + platform_fee_amount = delivery_fee
  )
);

comment on column public.orders.cod_amount is
  'TOTAL cash the rider collects from the customer, in MMK: goods value plus the '
  'delivery fee when fee_payer = ''customer''. Settlement math therefore never '
  'needs to branch on fee_payer.';
comment on column public.orders.assign_distance_km is
  'Crow-fly rider->pickup distance at the moment of assignment. Kept for '
  'dispatch-quality analytics; route_distance_km is pickup->dropoff.';

-- Dispatcher queue.
create index orders_pending_idx  on public.orders (created_at) where status = 'pending';
create index orders_pending_gix  on public.orders using gist (pickup_geog) where status = 'pending';
-- Rider's live job list.
create index orders_rider_open_idx on public.orders (rider_id, status)
  where status in ('assigned','picked_up');
create index orders_rider_idx    on public.orders (rider_id, created_at desc);
-- Shop views.
create index orders_shop_idx     on public.orders (shop_id, created_at desc);
create index orders_status_idx   on public.orders (status, created_at desc);
-- COD reconciliation.
create index orders_cod_open_idx on public.orders (rider_id, cod_status)
  where cod_status in ('pending','collected','remitted');
create index orders_dropoff_gix  on public.orders using gist (dropoff_geog);
create index orders_delivered_idx on public.orders (delivered_at desc) where status = 'delivered';


-- ----------------------------------------------------------------------------
-- 8. TABLE 6/11 — order_status_events  (append-only checkpoint trail)
-- ----------------------------------------------------------------------------

create table public.order_status_events (
  id          bigserial primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status   public.order_status not null,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_role  public.user_role,
  lat         double precision,
  lng         double precision,
  note        text,
  created_at  timestamptz not null default now()
);

create index ose_order_idx on public.order_status_events (order_id, created_at);
create index ose_actor_idx on public.order_status_events (actor_id, created_at desc);

comment on table public.order_status_events is
  'Immutable. Written ONLY by the tg_orders_audit SECURITY DEFINER trigger; '
  'RLS grants SELECT and nothing else.';


-- ----------------------------------------------------------------------------
-- 9. TABLE 7/11 — order_assignments  (offer / accept audit)
-- ----------------------------------------------------------------------------

create table public.order_assignments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  rider_id     uuid not null references public.rider_profiles(id) on delete cascade,
  rank         smallint,
  distance_km  numeric(6,2),
  response     public.offer_response not null default 'pending',
  offered_by   uuid references public.profiles(id) on delete set null,
  offered_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '90 seconds',
  responded_at timestamptz,
  unique (order_id, rider_id)
);

create index oa_rider_open_idx on public.order_assignments (rider_id, expires_at)
  where response = 'pending';
create index oa_order_idx on public.order_assignments (order_id, offered_at desc);


-- ----------------------------------------------------------------------------
-- 10. TABLE 8/11 — cod_ledger  (double-entry, append-only)
-- ----------------------------------------------------------------------------

create table public.cod_ledger (
  id            bigserial primary key,
  order_id      uuid references public.orders(id) on delete restrict,
  rider_id      uuid not null references public.rider_profiles(id) on delete restrict,
  kind          public.ledger_kind not null,
  amount        bigint not null,     -- signed; see comment on type ledger_kind
  settlement_id uuid,                -- FK added in §11 (settlements defined after)
  memo          text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint cod_ledger_nonzero check (amount <> 0)
);

create index cod_ledger_rider_idx on public.cod_ledger (rider_id, created_at desc);
create index cod_ledger_open_idx  on public.cod_ledger (rider_id, created_at)
  where settlement_id is null;
create index cod_ledger_order_idx on public.cod_ledger (order_id);
create index cod_ledger_stl_idx   on public.cod_ledger (settlement_id);


-- ----------------------------------------------------------------------------
-- 11. TABLE 9/11 — settlements
-- ----------------------------------------------------------------------------

create table public.settlements (
  id               uuid primary key default gen_random_uuid(),
  rider_id         uuid not null references public.rider_profiles(id) on delete restrict,
  period_date      date not null,
  gross_cod        bigint not null default 0,
  delivery_fees    bigint not null default 0,
  rider_earnings   bigint not null default 0,
  platform_share   bigint not null default 0,
  net_due_platform bigint not null default 0,   -- cash the rider hands in (may be negative)
  order_count      integer not null default 0,
  status           public.settlement_status not null default 'open',
  notes            text,
  approved_by      uuid references public.profiles(id) on delete set null,
  approved_at      timestamptz,
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (rider_id, period_date)
);

create index settlements_rider_idx  on public.settlements (rider_id, period_date desc);
create index settlements_status_idx on public.settlements (status, period_date desc);

create trigger settlements_touch before update on public.settlements
for each row execute function public.tg_touch_updated_at();

alter table public.cod_ledger
  add constraint cod_ledger_settlement_fk
  foreign key (settlement_id) references public.settlements(id) on delete set null;

comment on column public.settlements.net_due_platform is
  'gross_cod - rider_earnings. Negative means the platform owes the rider '
  '(prepaid deliveries earn commission with no cash collected).';


-- ----------------------------------------------------------------------------
-- 12. TABLE 10/11 — app_settings  (enforced singleton)
-- ----------------------------------------------------------------------------

create table public.app_settings (
  id                   boolean primary key default true check (id),

  brand_name           text not null default 'Mingalar Express',
  order_code_prefix    text not null default 'MGE',
  support_phone        text,

  -- pricing
  rider_commission_pct numeric(5,2) not null default 80.00
                         check (rider_commission_pct between 0 and 100),
  base_delivery_fee    bigint not null default 1500 check (base_delivery_fee >= 0),
  per_km_fee           bigint not null default 300  check (per_km_fee >= 0),
  free_km              numeric(4,1) not null default 2.0 check (free_km >= 0),
  road_factor          numeric(4,2) not null default 1.35 check (road_factor >= 1),

  -- dispatch tuning
  default_coverage_km  numeric(4,1) not null default 5.0,
  offer_ttl_seconds    integer not null default 90 check (offer_ttl_seconds between 15 and 900),
  rider_ping_stale_min integer not null default 10 check (rider_ping_stale_min between 1 and 120),

  -- soft service-area bounds (tunable without a migration; the hard geofence
  -- stays in public.in_service_area)
  bbox_south           double precision not null default 16.7850,
  bbox_north           double precision not null default 16.8950,
  bbox_west            double precision not null default 96.1350,
  bbox_east            double precision not null default 96.2350,
  map_center_lat       double precision not null default 16.8409,
  map_center_lng       double precision not null default 96.1735,
  map_default_zoom     smallint not null default 14,

  -- pluggable map provider (dev: raw OSM; prod: keyed tile host)
  map_provider         text not null default 'osm'
                         check (map_provider in ('osm','maptiler','stadia','geoapify','self_hosted')),
  tile_url_template    text,
  tile_attribution     text not null default
                         '&copy; OpenStreetMap contributors',
  geocoder_provider    text not null default 'nominatim'
                         check (geocoder_provider in ('nominatim','maptiler','geoapify','self_hosted')),
  geocoder_base_url    text not null default 'https://nominatim.openstreetmap.org',

  updated_by           uuid references public.profiles(id) on delete set null,
  updated_at           timestamptz not null default now()
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

create trigger app_settings_touch before update on public.app_settings
for each row execute function public.tg_touch_updated_at();

comment on table public.app_settings is
  'Single row (id = true). Read with: select * from app_settings where id;';
comment on column public.app_settings.map_provider is
  'Provider key consumed by lib/map/providers.ts. tile_url_template overrides the '
  'provider default; keys/secrets stay in env, never in this table.';


-- ----------------------------------------------------------------------------
-- 13. TABLE 11/11 — audit_log  (privileged-action trail)
-- ----------------------------------------------------------------------------

create table public.audit_log (
  id           bigserial primary key,
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_role   public.user_role,
  action       text not null,
  entity_table text not null,
  entity_id    text,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);

create index audit_entity_idx on public.audit_log (entity_table, entity_id, created_at desc);
create index audit_actor_idx  on public.audit_log (actor_id, created_at desc);

comment on table public.audit_log is
  'Append-only. Role changes, pricing changes, settlement approvals, manual '
  'ledger adjustments. Written by SECURITY DEFINER triggers only.';


-- ----------------------------------------------------------------------------
-- 14. GRANTS
--     RLS is the boundary; these are the table-level privileges RLS filters.
--     `authenticated` needs USAGE on order_seq because the orders.code DEFAULT
--     calls nextval() as the *inserting* role.
-- ----------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- anon gets nothing but the public tracking RPC (added in 0002).
revoke all on all tables in schema public from anon;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
