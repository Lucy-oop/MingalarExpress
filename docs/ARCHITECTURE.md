# Mingalar Express — Technical Architecture

**Hyper-local parcel delivery + COD platform · Thingangyun Township, Yangon**
Stack: Next.js 15 (App Router) · Supabase (Postgres 15 + PostGIS, Auth, Realtime, Storage) · Tailwind + shadcn/ui · Leaflet + OpenStreetMap

> **Naming note:** brand assets read *Mingalar Delivery*; this spec uses *Mingalar Express* as the codebase/product name per the brief. Pick one before Phase 1 — it leaks into `app_settings`, email templates, PWA manifest and the storage bucket names.

---

## 0. Architectural decisions (read first)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Single Next.js app + RBAC route groups**, not 4 deployments | One auth session, one Supabase client, shared `orders` types. Role gates live in middleware + RLS (defence in depth). |
| D2 | **PostGIS `geography(Point,4326)` + GiST**, not raw lat/lng math in SQL | `ST_DWithin` / `<->` KNN are index-accelerated. Haversine in TS stays for client-side ranking & display only (§3). Never filter thousands of riders with Haversine in JS. |
| D3 | **Lat/lng stored as `double precision`, geography as a `GENERATED ... STORED` column** | Forms and Leaflet speak lat/lng; the index needs geography. Generated = impossible to desync. |
| D4 | **Money as `bigint` MMK, no decimals** | MMK has no practical subunit. Float money is a settlement bug generator. |
| D5 | **Commission is *snapshotted* onto the order at assignment time** | Changing the 80/20 split next month must not retroactively rewrite last month's settlements. |
| D6 | **Assignment goes through a locking RPC (`assign_order`)**, never a bare `UPDATE` from the client | Two dispatchers clicking the same rider is a real race in a live dispatch room. |
| D7 | **Status transitions enforced in the DB**, not just the UI | A rider replaying a stale `delivered` request must fail closed. |
| D8 | **Orders → Realtime `postgres_changes`; rider GPS → Realtime `presence`/`broadcast`** | Location pings at 10s intervals × 40 riders would flood WAL replication. Presence is ephemeral and free. |
| D9 | **Delivery proof photos in a private bucket**, signed URLs only | Photos contain customer doors, faces, addresses. |
| D10 | **`status` + `order_status_events` (append-only)** | Checkpoint tracking *and* an immutable audit trail for COD disputes. |

Added beyond the brief (recommended, small cost): `failed` order status (attempted, returning to shop), `order_assignments` offer table (rider *accept* flow needs a record of who was offered what), `cod_ledger` (COD audit logs need double-entry, not a boolean).

---

## 0b. Phase 1 corrections (found by executing the schema)

The Phase 1 migrations were run against `ghcr.io/supabase/postgres:17.6.1.158` and asserted with 46 checks. Five things in §1 below were wrong or insufficient as written; the migrations in `supabase/migrations/` are authoritative where they differ.

| # | Issue | Fix |
|---|---|---|
| C1 | `public.auth_role()` — `CURRENT_ROLE` is a **reserved SQL keyword**; the helper cannot safely carry that name. | Renamed to `public.auth_role()`. |
| C2 | Every privilege guard tested `is_admin()`, which is false when there is no JWT. That blocks the *service-role* Admin API, `pg_cron`, the SQL editor and `seed.sql` — i.e. all legitimate administration. Caught the first time the seed ran. | Added `public.is_service_ctx()` (`auth.uid() is null`) and threaded it through both guards, `assign_order`, `advance_order`, `rider_heartbeat` and `build_settlement`. |
| C3 | "No UPDATE policy" does **not** make a table immutable. RLS silently matches zero rows on UPDATE/DELETE and reports success — a super_admin editing the ledger got a no-op, not an error. | Explicit `REVOKE UPDATE, DELETE` on `cod_ledger`, `order_status_events`, `audit_log` (0003). INSERT is the exception: it *does* raise 42501 with no policy. |
| C4 | Column-level `REVOKE`/`GRANT` on `rider_profiles` would have locked Super Admins out too — column privileges apply to every `authenticated` user regardless of policy. | Replaced with `tg_riders_guard` + a tx-local bypass flag for internal capacity bookkeeping. |
| C5 | `profiles.phone NOT NULL` is unsatisfiable from the signup trigger, which has no phone to insert; a placeholder would collide with the unique index. | Nullable with a partial unique index; required at the application layer before a shop can order or a rider can go online. |

| C6 | `tg_on_auth_user_created` fired `AFTER INSERT` only. GoTrue's admin `createUser` **inserts the user, then updates it** with `app_metadata` — so the role claim is not there yet, and every admin-created rider/dispatcher silently landed as the default `shop_owner`. Verified against gotrue v2.195.0. | Added `tg_on_auth_user_meta_changed` (`AFTER UPDATE OF raw_app_meta_data`). `app_metadata` is now the single source of truth for role, and promotion works for free. |
| C8 | Seeded `auth.users` rows **could not sign in** — GoTrue scans its token columns into non-nullable Go strings, so one NULL (`reauthentication_token`) fails the login with "Database error querying schema" while admin user creation still succeeds. The README promised those logins worked. | `seed.sql` now sets all eight token columns to `''`. |
| C7 | `createServerClient` throws when the URL/key are missing. Because it is called from root middleware, one missing env var **500'd every route** — including the public tracking page that needs no session. | `lib/env.ts` resolves once; middleware fails *closed* on protected paths (no client → no user → redirect) and keeps serving public ones. |

Verified behaviourally, not just structurally: the D6 concurrency claim was tested with two real sessions — the loser blocked on the row lock for 3s, then failed `order_not_assignable`, and exactly one rider ended up holding capacity.

---

## 1. PostgreSQL schema

File: `supabase/migrations/0001_init.sql`

### 1.1 Extensions, enums, helpers

```sql
create extension if not exists "pgcrypto"  with schema extensions;
create extension if not exists "postgis"   with schema extensions;

-- Supabase keeps extensions out of `public`; generated columns must reference
-- them schema-qualified because generated expressions ignore search_path.

create type public.user_role         as enum ('super_admin','dispatcher','shop_owner','rider');
create type public.order_status      as enum ('pending','assigned','picked_up','delivered','failed','cancelled');
create type public.rider_availability as enum ('available','busy');
create type public.payment_method    as enum ('cod','prepaid');
create type public.cod_status        as enum ('none','pending','collected','remitted','settled');
create type public.settlement_status as enum ('open','submitted','approved','paid');
create type public.offer_response    as enum ('pending','accepted','rejected','expired');
create type public.ledger_kind       as enum ('cod_collected','cod_remitted','commission_earned','platform_fee','adjustment');
```

Thingangyun service-area guard (approximate bbox — replace with the real township polygon in Phase 1):

```sql
create or replace function public.in_service_area(p_lat double precision, p_lng double precision)
returns boolean
language sql immutable parallel safe
as $$
  select p_lat between 16.78 and 16.90
     and p_lng between 96.12 and 96.24;
$$;
```

### 1.2 `profiles` — auth mirror + role

```sql
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        public.user_role not null,
  full_name   text not null check (length(trim(full_name)) > 0),
  phone       text not null check (phone ~ '^\+959[0-9]{7,9}$'),
  avatar_path text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index profiles_phone_key on public.profiles (phone);
create index profiles_role_idx on public.profiles (role) where is_active;
```

Role resolution helpers. `security definer` so RLS policies can read `profiles` without recursing into `profiles`' own policy:

```sql
create or replace function public.auth_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and is_active $$;

create or replace function public.is_admin() returns boolean
language sql stable as $$ select public.auth_role() = 'super_admin' $$;

create or replace function public.is_dispatch() returns boolean
language sql stable as $$ select public.auth_role() in ('super_admin','dispatcher') $$;

create or replace function public.owns_shop(p_shop_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.shops s where s.id = p_shop_id and s.owner_id = auth.uid()) $$;

revoke execute on function public.auth_role() from anon;
```

Block privilege self-escalation — a `shop_owner` must not `UPDATE profiles SET role='super_admin'`:

```sql
create or replace function public.tg_profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if new.role <> old.role or new.is_active <> old.is_active then
      raise exception 'role_change_forbidden' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
for each row execute function public.tg_profiles_guard();
```

### 1.3 `service_areas` — the local ward layer

Kept as a table, not an enum: wards get added and renamed, enums require a migration.

```sql
create table public.service_areas (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,              -- 'San Pya', 'Lhay Htaung Kan', 'Saung Thuma'
  name_mm   text,                              -- Burmese label for rider/shop UI
  centroid  extensions.geography(Point,4326),
  boundary  extensions.geography(Polygon,4326),-- optional, for point-in-ward
  is_active boolean not null default true
);
create index service_areas_boundary_gix on public.service_areas using gist (boundary);
```

### 1.4 `shops`

```sql
create table public.shops (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles(id) on delete restrict,
  name            text not null,
  phone           text not null check (phone ~ '^\+959[0-9]{7,9}$'),
  area_id         uuid references public.service_areas(id),
  pickup_address  text not null,
  pickup_lat      double precision not null check (pickup_lat  between -90 and 90),
  pickup_lng      double precision not null check (pickup_lng between -180 and 180),
  pickup_geog     extensions.geography(Point,4326)
                  generated always as
                  (extensions.st_setsrid(extensions.st_makepoint(pickup_lng, pickup_lat), 4326)::extensions.geography)
                  stored,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint shops_in_service_area check (public.in_service_area(pickup_lat, pickup_lng))
);
create index shops_owner_idx    on public.shops (owner_id);
create index shops_pickup_gix   on public.shops using gist (pickup_geog);
```

### 1.5 `rider_profiles`

```sql
create table public.rider_profiles (
  id                     uuid primary key references public.profiles(id) on delete cascade,
  base_area_id           uuid references public.service_areas(id),
  coverage_km            numeric(4,1) not null default 5.0 check (coverage_km between 0.5 and 30),
  is_online              boolean not null default false,
  availability           public.rider_availability not null default 'available',
  current_lat            double precision,
  current_lng            double precision,
  current_geog           extensions.geography(Point,4326)
                         generated always as
                         (case when current_lat is null or current_lng is null then null
                          else extensions.st_setsrid(extensions.st_makepoint(current_lng, current_lat), 4326)::extensions.geography
                          end) stored,
  last_ping_at           timestamptz,
  vehicle_plate          text,
  nrc_no                 text,
  commission_pct_override numeric(5,2) check (commission_pct_override between 0 and 100),
  max_active_orders      smallint not null default 3 check (max_active_orders between 1 and 10),
  active_order_count     smallint not null default 0 check (active_order_count >= 0),
  cod_float_limit        bigint not null default 500000,   -- MMK cash-in-hand ceiling
  created_at             timestamptz not null default now()
);

-- The dispatch hot path. Partial + GiST: only online, free riders are ever scanned.
create index riders_dispatch_gix on public.rider_profiles using gist (current_geog)
  where is_online and availability = 'available';
create index riders_area_idx     on public.rider_profiles (base_area_id) where is_online;
create index riders_ping_idx     on public.rider_profiles (last_ping_at desc) where is_online;
```

### 1.6 `orders`

Pickup/dropoff are **snapshotted** onto the order, not joined from `shops` — a shop editing its address must not rewrite delivery history.

```sql
create sequence public.order_seq;

create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique
                    default 'MGE-' || to_char(now(),'YYMMDD') || '-' || lpad(nextval('public.order_seq')::text, 5, '0'),
  shop_id           uuid not null references public.shops(id) on delete restrict,
  rider_id          uuid references public.rider_profiles(id) on delete set null,
  status            public.order_status not null default 'pending',

  -- pickup snapshot
  pickup_address    text not null,
  pickup_lat        double precision not null,
  pickup_lng        double precision not null,
  pickup_geog       extensions.geography(Point,4326)
                    generated always as
                    (extensions.st_setsrid(extensions.st_makepoint(pickup_lng, pickup_lat), 4326)::extensions.geography) stored,
  pickup_contact    text,

  -- customer / dropoff
  customer_name     text not null,
  customer_phone    text not null check (customer_phone ~ '^\+959[0-9]{7,9}$'),
  customer_phone_alt text,
  dropoff_address   text not null,
  dropoff_area_id   uuid references public.service_areas(id),
  dropoff_lat       double precision not null,
  dropoff_lng       double precision not null,
  dropoff_geog      extensions.geography(Point,4326)
                    generated always as
                    (extensions.st_setsrid(extensions.st_makepoint(dropoff_lng, dropoff_lat), 4326)::extensions.geography) stored,
  dropoff_note      text,                         -- 'blue gate, 2nd floor, ring twice'

  -- parcel
  parcel_desc       text not null,
  parcel_weight_g   integer check (parcel_weight_g between 0 and 50000),
  is_fragile        boolean not null default false,

  -- money (MMK, integer)
  payment_method    public.payment_method not null default 'cod',
  cod_amount        bigint not null default 0 check (cod_amount >= 0),
  delivery_fee      bigint not null check (delivery_fee >= 0),
  fee_payer         text not null default 'customer' check (fee_payer in ('customer','shop')),
  cod_status        public.cod_status not null default 'none',
  rider_commission_pct    numeric(5,2),           -- snapshot @ assignment (D5)
  rider_commission_amount bigint,
  platform_fee_amount     bigint,

  -- routing / ops
  route_distance_km numeric(6,2),
  assigned_at       timestamptz,
  assigned_by       uuid references public.profiles(id),
  picked_up_at      timestamptz,
  delivered_at      timestamptz,
  closed_at         timestamptz,
  fail_reason       text,
  cancel_reason     text,
  proof_photo_path  text,                          -- storage key in `delivery-proofs`
  proof_receiver    text,
  created_by        uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint orders_cod_consistent check (
    (payment_method = 'cod' and cod_amount > 0) or (payment_method = 'prepaid' and cod_amount = 0)
  ),
  constraint orders_delivered_needs_proof check (
    status <> 'delivered' or proof_photo_path is not null
  ),
  constraint orders_pickup_in_area   check (public.in_service_area(pickup_lat, pickup_lng)),
  constraint orders_dropoff_in_area  check (public.in_service_area(dropoff_lat, dropoff_lng))
);

-- Dispatcher queue: pending orders, oldest first.
create index orders_pending_idx   on public.orders (created_at) where status = 'pending';
create index orders_pending_gix   on public.orders using gist (pickup_geog) where status = 'pending';
create index orders_rider_open_idx on public.orders (rider_id, status)
  where status in ('assigned','picked_up');
create index orders_shop_idx      on public.orders (shop_id, created_at desc);
create index orders_status_idx    on public.orders (status, created_at desc);
create index orders_cod_open_idx  on public.orders (rider_id, cod_status)
  where cod_status in ('collected','remitted');
create index orders_dropoff_gix   on public.orders using gist (dropoff_geog);
```

### 1.7 Checkpoint trail, offers, COD ledger, settlements, settings

```sql
create table public.order_status_events (
  id          bigserial primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status   public.order_status not null,
  actor_id    uuid references public.profiles(id),
  actor_role  public.user_role,
  lat         double precision,
  lng         double precision,
  note        text,
  created_at  timestamptz not null default now()
);
create index ose_order_idx on public.order_status_events (order_id, created_at);

create table public.order_assignments (              -- offer/accept audit
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  rider_id    uuid not null references public.rider_profiles(id) on delete cascade,
  rank        smallint,
  distance_km numeric(6,2),
  response    public.offer_response not null default 'pending',
  offered_by  uuid references public.profiles(id),
  offered_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '90 seconds',
  responded_at timestamptz,
  unique (order_id, rider_id)
);
create index oa_rider_open_idx on public.order_assignments (rider_id, response) where response = 'pending';

create table public.cod_ledger (                     -- append-only, never UPDATE
  id            bigserial primary key,
  order_id      uuid references public.orders(id) on delete restrict,
  rider_id      uuid not null references public.rider_profiles(id) on delete restrict,
  kind          public.ledger_kind not null,
  amount        bigint not null,                     -- signed: + owed to platform, - paid out
  settlement_id uuid,
  memo          text,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index cod_ledger_rider_idx on public.cod_ledger (rider_id, created_at desc);
create index cod_ledger_open_idx  on public.cod_ledger (rider_id) where settlement_id is null;

create table public.settlements (
  id              uuid primary key default gen_random_uuid(),
  rider_id        uuid not null references public.rider_profiles(id) on delete restrict,
  period_date     date not null,
  gross_cod       bigint not null default 0,
  delivery_fees   bigint not null default 0,
  rider_earnings  bigint not null default 0,
  platform_share  bigint not null default 0,
  net_due_platform bigint not null default 0,        -- cash the rider hands in
  order_count     integer not null default 0,
  status          public.settlement_status not null default 'open',
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  paid_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (rider_id, period_date)
);
alter table public.cod_ledger
  add constraint cod_ledger_settlement_fk
  foreign key (settlement_id) references public.settlements(id) on delete set null;

create table public.app_settings (                   -- enforced singleton
  id                    boolean primary key default true check (id),
  brand_name            text    not null default 'Mingalar Express',
  rider_commission_pct  numeric(5,2) not null default 80.00 check (rider_commission_pct between 0 and 100),
  base_delivery_fee     bigint  not null default 1500,
  per_km_fee            bigint  not null default 300,
  free_km               numeric(4,1) not null default 2.0,
  default_coverage_km   numeric(4,1) not null default 5.0,
  offer_ttl_seconds     integer not null default 90,
  rider_ping_stale_min  integer not null default 10,
  updated_by            uuid references public.profiles(id),
  updated_at            timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict do nothing;
```

### 1.8 Status machine (DB-enforced) + auto audit trail

```sql
create or replace function public.tg_orders_status_machine()
returns trigger language plpgsql set search_path = public as $$
declare ok boolean;
begin
  if new.status = old.status then
    new.updated_at := now();
    return new;
  end if;

  ok := case old.status
          when 'pending'   then new.status in ('assigned','cancelled')
          when 'assigned'  then new.status in ('picked_up','pending','cancelled')  -- pending = unassign
          when 'picked_up' then new.status in ('delivered','failed')
          when 'failed'    then new.status in ('assigned','cancelled')
          else false                                                              -- delivered/cancelled are terminal
        end;
  if not ok then
    raise exception 'illegal_transition_%_to_%', old.status, new.status using errcode = '55000';
  end if;

  new.updated_at := now();
  if new.status = 'picked_up'  then new.picked_up_at := coalesce(new.picked_up_at, now()); end if;
  if new.status = 'delivered'  then
    new.delivered_at := coalesce(new.delivered_at, now());
    new.closed_at    := now();
    if new.payment_method = 'cod' then new.cod_status := 'collected'; end if;
  end if;
  if new.status in ('cancelled','failed') then new.closed_at := now(); end if;
  return new;
end $$;

create trigger orders_status_machine before update on public.orders
for each row execute function public.tg_orders_status_machine();

create or replace function public.tg_orders_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status <> old.status then
    insert into public.order_status_events (order_id, from_status, to_status, actor_id, actor_role, note)
    values (new.id,
            case when tg_op = 'UPDATE' then old.status end,
            new.status, auth.uid(), public.auth_role(),
            coalesce(new.fail_reason, new.cancel_reason));
  end if;

  -- release rider capacity when an order closes
  if tg_op = 'UPDATE' and new.rider_id is not null
     and old.status in ('assigned','picked_up')
     and new.status in ('delivered','failed','cancelled') then
    perform set_config('app.rider_guard_bypass', 'on', true);
    update public.rider_profiles
       set active_order_count = greatest(active_order_count - 1, 0),
           availability = 'available'
     where id = new.rider_id;
  end if;

  -- COD becomes a ledger entry the moment it is collected
  if tg_op = 'UPDATE' and new.status = 'delivered' and new.payment_method = 'cod' and new.cod_amount > 0 then
    insert into public.cod_ledger (order_id, rider_id, kind, amount, created_by, memo)
    values (new.id, new.rider_id, 'cod_collected', new.cod_amount, coalesce(auth.uid(), new.rider_id), new.code),
           (new.id, new.rider_id, 'commission_earned', -coalesce(new.rider_commission_amount,0), coalesce(auth.uid(), new.rider_id), new.code);
  end if;
  return new;
end $$;

create trigger orders_audit after insert or update on public.orders
for each row execute function public.tg_orders_audit();
```

> The `values (...), (...)` multi-row insert above is intentional: COD collected (+) and rider commission owed (−) are two ledger lines, so a rider's net cash-in equals `sum(amount)` over unsettled rows.

### 1.9 Dispatch & operational RPCs

**Nearest available riders** — the core local-matching query. Index-accelerated `ST_DWithin` + KNN ordering, respecting each rider's own `coverage_km`:

```sql
create or replace function public.nearby_available_riders(
  p_order_id uuid,
  p_limit    integer default 10,
  p_max_km   numeric default null
)
returns table (
  rider_id      uuid,
  full_name     text,
  phone         text,
  base_area     text,
  distance_km   numeric,
  active_orders smallint,
  coverage_km   numeric,
  cod_in_hand   bigint,
  last_ping_at  timestamptz
)
language sql stable security invoker set search_path = public, extensions
as $$
  with o as (select pickup_geog from public.orders where id = p_order_id),
       s as (select rider_ping_stale_min from public.app_settings where id)
  select r.id,
         p.full_name,
         p.phone,
         a.name,
         round((extensions.st_distance(r.current_geog, o.pickup_geog) / 1000)::numeric, 2),
         r.active_order_count,
         r.coverage_km,
         coalesce((select sum(l.amount) from public.cod_ledger l
                    where l.rider_id = r.id and l.settlement_id is null), 0),
         r.last_ping_at
    from public.rider_profiles r
    cross join o cross join s
    join public.profiles p on p.id = r.id and p.is_active
    left join public.service_areas a on a.id = r.base_area_id
   where r.is_online
     and r.availability = 'available'
     and r.current_geog is not null
     and r.last_ping_at > now() - make_interval(mins => s.rider_ping_stale_min)
     and r.active_order_count < r.max_active_orders
     and extensions.st_dwithin(
           r.current_geog, o.pickup_geog,
           least(coalesce(p_max_km, r.coverage_km), r.coverage_km) * 1000)
   order by r.current_geog <-> o.pickup_geog
   limit p_limit;
$$;
```

**Atomic assignment** (D6):

```sql
create or replace function public.assign_order(p_order_id uuid, p_rider_id uuid)
returns public.orders
language plpgsql security definer set search_path = public, extensions
as $$
declare v_o public.orders; v_r public.rider_profiles; v_pct numeric; v_com bigint;
begin
  if not public.is_dispatch() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;
  if v_o.status not in ('pending','failed') then
    raise exception 'order_not_assignable:%', v_o.status using errcode = '55000';
  end if;

  select * into v_r from public.rider_profiles where id = p_rider_id for update;
  if not found or not v_r.is_online or v_r.availability <> 'available'
     or v_r.active_order_count >= v_r.max_active_orders then
    raise exception 'rider_unavailable' using errcode = '55000';
  end if;

  select coalesce(v_r.commission_pct_override, rider_commission_pct)
    into v_pct from public.app_settings where id;
  v_com := floor(v_o.delivery_fee * v_pct / 100.0);

  update public.orders
     set rider_id = p_rider_id, status = 'assigned',
         assigned_at = now(), assigned_by = auth.uid(),
         rider_commission_pct = v_pct,
         rider_commission_amount = v_com,
         platform_fee_amount = v_o.delivery_fee - v_com,
         route_distance_km = round((extensions.st_distance(v_o.pickup_geog, v_o.dropoff_geog)/1000)::numeric, 2),
         cod_status = case when v_o.payment_method = 'cod' then 'pending' else 'none' end
   where id = p_order_id
   returning * into v_o;

  perform set_config('app.rider_guard_bypass', 'on', true);
  update public.rider_profiles
     set active_order_count = active_order_count + 1,
         availability = case when active_order_count + 1 >= max_active_orders
                            then 'busy'::public.rider_availability
                            else 'available'::public.rider_availability end
   where id = p_rider_id;

  insert into public.order_assignments (order_id, rider_id, response, offered_by, responded_at, distance_km)
  values (p_order_id, p_rider_id, 'accepted', auth.uid(), now(), v_o.route_distance_km)
  on conflict (order_id, rider_id) do update set response = 'accepted', responded_at = now();

  return v_o;
end $$;
```

**Rider status advance** (rider-scoped, proof-gated):

```sql
create or replace function public.advance_order(
  p_order_id  uuid,
  p_to        public.order_status,
  p_lat       double precision default null,
  p_lng       double precision default null,
  p_proof     text default null,
  p_receiver  text default null,
  p_reason    text default null
) returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_o public.orders;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;
  if v_o.rider_id is distinct from auth.uid() and not public.is_dispatch() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_to = 'delivered' and p_proof is null and v_o.proof_photo_path is null then
    raise exception 'proof_required' using errcode = '55000';
  end if;

  update public.orders
     set status = p_to,
         proof_photo_path = coalesce(p_proof, proof_photo_path),
         proof_receiver   = coalesce(p_receiver, proof_receiver),
         fail_reason      = case when p_to = 'failed' then p_reason else fail_reason end
   where id = p_order_id returning * into v_o;

  insert into public.order_status_events (order_id, from_status, to_status, actor_id, actor_role, lat, lng, note)
  values (p_order_id, null, p_to, auth.uid(), public.auth_role(), p_lat, p_lng, 'rider-geo');
  return v_o;
end $$;
```

**Rider heartbeat** (called every 10–20s from the PWA; cheap, single row):

```sql
create or replace function public.rider_heartbeat(
  p_lat double precision, p_lng double precision, p_online boolean default true
) returns void
language sql security definer set search_path = public
as $$
  update public.rider_profiles
     set current_lat = p_lat, current_lng = p_lng,
         last_ping_at = now(), is_online = p_online
   where id = auth.uid();
$$;
```

**Daily settlement build:**

```sql
create or replace function public.build_settlement(p_rider_id uuid, p_date date)
returns public.settlements
language plpgsql security definer set search_path = public
as $$
declare v_s public.settlements;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;

  insert into public.settlements (rider_id, period_date) values (p_rider_id, p_date)
  on conflict (rider_id, period_date) do update set period_date = excluded.period_date
  returning * into v_s;

  update public.cod_ledger set settlement_id = v_s.id
   where rider_id = p_rider_id and settlement_id is null
     and created_at < (p_date + 1)::timestamptz;

  update public.settlements s set
    gross_cod        = t.cod,
    delivery_fees    = t.fees,
    rider_earnings   = t.earn,
    platform_share   = t.fees - t.earn,
    net_due_platform = t.cod - t.earn,
    order_count      = t.cnt,
    status           = 'submitted'
  from (
    select coalesce(sum(o.cod_amount),0) cod,
           coalesce(sum(o.delivery_fee),0) fees,
           coalesce(sum(o.rider_commission_amount),0) earn,
           count(*) cnt
      from public.cod_ledger l join public.orders o on o.id = l.order_id
     where l.settlement_id = v_s.id and l.kind = 'cod_collected'
  ) t
  where s.id = v_s.id returning * into v_s;

  update public.orders o set cod_status = 'settled'
   from public.cod_ledger l
   where l.order_id = o.id and l.settlement_id = v_s.id;
  return v_s;
end $$;
```

### 1.10 Row-Level Security

Deny-by-default on every table, then grant per role. **Riders and shops never see each other's rows.**

```sql
alter table public.profiles            enable row level security;
alter table public.shops               enable row level security;
alter table public.rider_profiles      enable row level security;
alter table public.orders              enable row level security;
alter table public.order_status_events enable row level security;
alter table public.order_assignments   enable row level security;
alter table public.cod_ledger          enable row level security;
alter table public.settlements         enable row level security;
alter table public.app_settings        enable row level security;
alter table public.service_areas       enable row level security;

-- profiles ------------------------------------------------------------------
create policy profiles_self_read on public.profiles for select
  using (id = auth.uid() or public.is_dispatch());
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
create policy profiles_admin_insert on public.profiles for insert
  with check (public.is_admin());

-- service_areas: readable by all authenticated, writable by admin ------------
create policy areas_read  on public.service_areas for select using (auth.uid() is not null);
create policy areas_write on public.service_areas for all
  using (public.is_admin()) with check (public.is_admin());

-- shops ---------------------------------------------------------------------
create policy shops_owner_rw on public.shops for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy shops_dispatch_read on public.shops for select using (public.is_dispatch());
create policy shops_admin_write on public.shops for all
  using (public.is_admin()) with check (public.is_admin());
-- A rider may read only shops they currently have work for:
create policy shops_rider_read on public.shops for select using (
  exists (select 1 from public.orders o
           where o.shop_id = shops.id and o.rider_id = auth.uid()
             and o.status in ('assigned','picked_up'))
);

-- rider_profiles ------------------------------------------------------------
create policy riders_self_read   on public.rider_profiles for select using (id = auth.uid());
create policy riders_self_update on public.rider_profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());          -- column-level guard below
create policy riders_dispatch_read on public.rider_profiles for select using (public.is_dispatch());
create policy riders_admin_write   on public.rider_profiles for all
  using (public.is_admin()) with check (public.is_admin());

-- Riders may only toggle presence/location, never their own commission or caps.
-- NOTE: do NOT use column-level REVOKE/GRANT here -- column privileges apply to every
-- `authenticated` user, so revoking would also lock out Super Admins. Guard with a trigger.
create or replace function public.tg_riders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- internal bookkeeping from assign_order / orders_audit sets this tx-local flag
  if coalesce(current_setting('app.rider_guard_bypass', true), 'off') = 'on' then
    return new;
  end if;
  if public.is_admin() then return new; end if;
  if new.base_area_id            is distinct from old.base_area_id
  or new.commission_pct_override is distinct from old.commission_pct_override
  or new.max_active_orders       is distinct from old.max_active_orders
  or new.cod_float_limit         is distinct from old.cod_float_limit
  or new.active_order_count      is distinct from old.active_order_count
  or new.nrc_no                  is distinct from old.nrc_no then
    raise exception 'rider_field_admin_only' using errcode = '42501';
  end if;
  -- a rider may narrow, not widen, their own coverage radius
  if new.coverage_km > old.coverage_km then
    raise exception 'coverage_increase_admin_only' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger riders_guard before update on public.rider_profiles
for each row execute function public.tg_riders_guard();
-- Every SECURITY DEFINER routine that mutates rider capacity (assign_order,
-- tg_orders_audit) must open with:
--     perform set_config('app.rider_guard_bypass', 'on', true);   -- tx-local
-- rider_heartbeat deliberately does NOT set it: a rider's own presence and
-- location writes must pass the guard on their own merits.

-- orders --------------------------------------------------------------------
create policy orders_shop_read on public.orders for select
  using (public.owns_shop(shop_id));
create policy orders_shop_insert on public.orders for insert
  with check (public.owns_shop(shop_id) and created_by = auth.uid() and status = 'pending');
-- shop may only cancel while still pending
create policy orders_shop_update on public.orders for update
  using (public.owns_shop(shop_id) and status = 'pending')
  with check (public.owns_shop(shop_id) and status in ('pending','cancelled'));

create policy orders_rider_read on public.orders for select
  using (rider_id = auth.uid()
         or exists (select 1 from public.order_assignments a
                     where a.order_id = orders.id and a.rider_id = auth.uid()
                       and a.response = 'pending' and a.expires_at > now()));
create policy orders_rider_update on public.orders for update
  using (rider_id = auth.uid() and status in ('assigned','picked_up'))
  with check (rider_id = auth.uid());

create policy orders_dispatch_all on public.orders for all
  using (public.is_dispatch()) with check (public.is_dispatch());

-- order_status_events: read-only trail ---------------------------------------
create policy ose_read on public.order_status_events for select using (
  public.is_dispatch()
  or exists (select 1 from public.orders o where o.id = order_id
              and (public.owns_shop(o.shop_id) or o.rider_id = auth.uid()))
);
-- no INSERT/UPDATE/DELETE policy => only SECURITY DEFINER triggers write here.

-- order_assignments ---------------------------------------------------------
create policy oa_rider_read   on public.order_assignments for select using (rider_id = auth.uid() or public.is_dispatch());
create policy oa_rider_respond on public.order_assignments for update
  using (rider_id = auth.uid() and response = 'pending' and expires_at > now())
  with check (rider_id = auth.uid());
create policy oa_dispatch_write on public.order_assignments for all
  using (public.is_dispatch()) with check (public.is_dispatch());

-- cod_ledger: append-only, rider sees own -----------------------------------
create policy cod_rider_read on public.cod_ledger for select
  using (rider_id = auth.uid() or public.is_dispatch());
create policy cod_admin_insert on public.cod_ledger for insert with check (public.is_admin());
-- deliberately NO update/delete policy: the ledger is immutable.

-- settlements ---------------------------------------------------------------
create policy stl_rider_read on public.settlements for select
  using (rider_id = auth.uid() or public.is_dispatch());
create policy stl_admin_write on public.settlements for all
  using (public.is_admin()) with check (public.is_admin());

-- app_settings --------------------------------------------------------------
create policy settings_read  on public.app_settings for select using (auth.uid() is not null);
create policy settings_write on public.app_settings for update
  using (public.is_admin()) with check (public.is_admin());
```

**Signup trigger** — every `auth.users` row gets a profile; role defaults to `shop_owner`, riders are created by Super Admin:

```sql
create or replace function public.tg_on_auth_user_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name, phone)
  values (new.id,
          coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'shop_owner'),
          coalesce(new.raw_user_meta_data->>'full_name', 'New User'),
          coalesce(new.raw_user_meta_data->>'phone', '+959000000'));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.tg_on_auth_user_created();
```

> `raw_user_meta_data->>'role'` is **client-writable**. Gate it: only allow `shop_owner` from public signup and have Super Admin promote via the Admin API. In Phase 1, hard-code `'shop_owner'` and create riders/dispatchers with the service-role key from `/admin/super`.

### 1.11 Storage

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-proofs', 'delivery-proofs', false, 5242880, array['image/jpeg','image/webp','image/png'])
on conflict (id) do nothing;

-- path convention: <order_id>/<uuid>.webp
create policy proof_rider_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'delivery-proofs'
  and exists (select 1 from public.orders o
               where o.id = ((storage.foldername(name))[1])::uuid
                 and o.rider_id = auth.uid()
                 and o.status in ('assigned','picked_up'))
);

create policy proof_read on storage.objects for select to authenticated
using (
  bucket_id = 'delivery-proofs'
  and exists (select 1 from public.orders o
               where o.id = ((storage.foldername(name))[1])::uuid
                 and (o.rider_id = auth.uid() or public.owns_shop(o.shop_id) or public.is_dispatch()))
);
```

Client compresses to ≤ 1280px WebP before upload — Yangon mobile data is the constraint, not storage cost.

---
## 2. Next.js App Router structure

```
mingalar-express/
├── middleware.ts                       # session refresh + RBAC route gate
├── next.config.ts                      # PWA headers, image domains (tile server)
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 0001_init.sql               # §1.1–1.7  tables, enums, indexes
│   │   ├── 0002_triggers_rpc.sql        # §1.8–1.9  status machine, dispatch RPCs
│   │   ├── 0003_rls.sql                 # §1.10     policies + grants
│   │   ├── 0004_storage.sql             # §1.11
│   │   └── 0005_realtime.sql            # §4        publication + broadcast policies
│   └── seed.sql                         # service_areas, app_settings, demo shop/riders
│
├── app/
│   ├── layout.tsx                       # <html lang="my"> ThemeProvider, Toaster, brand fonts
│   ├── globals.css                      # Tailwind + brand tokens (§2.4)
│   ├── page.tsx                         # public landing / tracking entry
│   ├── manifest.ts                      # PWA manifest (name, red #C62828 theme, icons)
│   │
│   ├── (public)/
│   │   └── track/[code]/page.tsx         # customer checkpoint timeline, no auth (RPC by code)
│   │
│   ├── (auth)/
│   │   ├── layout.tsx                    # centered card, logo
│   │   ├── login/page.tsx                # phone+password / OTP
│   │   ├── register/page.tsx             # shop self-signup only
│   │   ├── forgot-password/page.tsx
│   │   └── callback/route.ts             # exchangeCodeForSession → role-based redirect
│   │
│   ├── shop/
│   │   ├── layout.tsx                    # requireRole('shop_owner') + sidebar
│   │   ├── dashboard/page.tsx            # KPI tiles + today's orders
│   │   ├── orders/
│   │   │   ├── page.tsx                  # filterable table (server component)
│   │   │   ├── new/page.tsx              # OrderForm + dual LocationPicker
│   │   │   └── [id]/page.tsx             # detail + live status timeline
│   │   ├── settings/page.tsx             # shop profile, pickup point
│   │   └── billing/page.tsx              # fees owed / COD received
│   │
│   ├── rider/                            # mobile-first PWA surface
│   │   ├── layout.tsx                    # requireRole('rider'); bottom tab bar, no sidebar
│   │   ├── dashboard/page.tsx            # online toggle + nearest jobs feed
│   │   ├── jobs/[id]/page.tsx            # job sheet: map, call, status buttons, proof upload
│   │   ├── history/page.tsx
│   │   └── earnings/page.tsx             # commission today / week, COD in hand
│   │
│   ├── admin/
│   │   ├── layout.tsx                    # requireRole('dispatcher','super_admin')
│   │   ├── dispatcher/
│   │   │   ├── page.tsx                  # split view: pending queue | live map
│   │   │   └── [orderId]/assign/page.tsx # ranked rider list (RPC), one-click assign
│   │   ├── super/
│   │   │   ├── page.tsx                  # org overview
│   │   │   ├── riders/page.tsx           # register rider, base_area, coverage_km
│   │   │   ├── shops/page.tsx
│   │   │   ├── areas/page.tsx            # service_areas CRUD + centroid picker
│   │   │   ├── pricing/page.tsx          # base fee, per-km, 80/20 split
│   │   │   └── settlements/
│   │   │       ├── page.tsx              # daily COD run
│   │   │       └── [id]/page.tsx         # approve / mark paid
│   │   └── audit/page.tsx                # cod_ledger + order_status_events explorer
│   │
│   └── api/
│       ├── riders/heartbeat/route.ts     # POST, edge runtime, wraps rider_heartbeat RPC
│       ├── orders/[id]/assign/route.ts   # POST, service-role → assign_order
│       ├── orders/quote/route.ts         # POST, fee quote from distance + app_settings
│       └── admin/users/route.ts          # POST, service-role createUser for riders/dispatchers
│
├── components/
│   ├── ui/                               # shadcn primitives (button, dialog, table, …)
│   ├── map/
│   │   ├── MapCanvas.tsx                 # 'use client' Leaflet shell, ssr:false dynamic import
│   │   ├── LocationPicker.tsx            # draggable pin + reverse geocode (Nominatim)
│   │   ├── LiveDispatchMap.tsx           # rider markers + pending pins, presence-driven
│   │   └── RouteLine.tsx                 # pickup→dropoff polyline
│   ├── orders/{OrderForm,OrderTable,StatusBadge,StatusTimeline,CodBadge}.tsx
│   ├── riders/{RiderRankList,OnlineToggle,RiderCard}.tsx
│   └── shared/{RoleGate,Money,PhoneLink,EmptyState}.tsx
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts                     # browser  – createBrowserClient
│   │   ├── server.ts                     # RSC/action – createServerClient + cookies()
│   │   ├── middleware.ts                 # updateSession helper
│   │   └── admin.ts                       # service-role, server-only guard
│   ├── auth/guards.ts                    # requireUser(), requireRole(), getProfile()
│   ├── geo/
│   │   ├── haversine.ts                  # §3
│   │   ├── dispatch.ts                   # §3 ranking + scoring
│   │   └── thingangyun.ts                # bbox, ward centroids, map defaults
│   ├── pricing.ts                        # quoteFee(), splitCommission()
│   ├── realtime/{useOrderStream,useRiderPresence,channels}.ts   # §4
│   ├── validation/schemas.ts             # zod: OrderCreate, RiderCreate, Settings
│   └── utils.ts                          # cn(), formatMMK(), formatMyanmarPhone()
│
├── types/
│   ├── database.types.ts                 # generated: supabase gen types typescript
│   └── domain.ts                          # Order, RiderCandidate, Money aliases
│
├── hooks/{useGeolocation,useOnlineStatus,useDebounce}.ts
└── public/
    ├── icons/                            # 192/512 maskable, brand red bg
    └── sw.js                             # next-pwa generated
```

### 2.1 Supabase clients

`lib/supabase/server.ts` — the only client used in Server Components, Route Handlers and Server Actions:

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database.types'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) }
          catch { /* called from a Server Component – middleware already refreshed */ }
        },
      },
    },
  )
}
```

`lib/supabase/admin.ts` — service-role, bypasses RLS. Used **only** for creating rider/dispatcher accounts and cron settlements:

```ts
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)
```

### 2.2 Middleware RBAC gate

`middleware.ts` — refreshes the session cookie **and** does a coarse path/role check. It is a UX gate, not the security boundary; RLS is.

```ts
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const ROUTE_ROLES: Record<string, string[]> = {
  '/shop':            ['shop_owner'],
  '/rider':           ['rider'],
  '/admin/super':     ['super_admin'],
  '/admin':           ['dispatcher', 'super_admin'],
}
const HOME: Record<string, string> = {
  shop_owner:  '/shop/dashboard',
  rider:       '/rider/dashboard',
  dispatcher:  '/admin/dispatcher',
  super_admin: '/admin/super',
}

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value))
          res = NextResponse.next({ request: req })
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
        },
      },
    },
  )

  // getUser() (not getSession()) — it revalidates the JWT server-side.
  const { data: { user } } = await supabase.auth.getUser()
  const path = req.nextUrl.pathname

  const match = Object.keys(ROUTE_ROLES)
    .sort((a, b) => b.length - a.length)          // '/admin/super' before '/admin'
    .find((prefix) => path.startsWith(prefix))

  if (!match) return res

  if (!user) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  // Role from the JWT if a custom access-token hook injects it, else one cheap read.
  const claimRole = (user.app_metadata as { role?: string } | undefined)?.role
  const role = claimRole ?? (await supabase.from('profiles')
      .select('role').eq('id', user.id).single()).data?.role

  if (!role || !ROUTE_ROLES[match].includes(role)) {
    return NextResponse.redirect(new URL(HOME[role ?? ''] ?? '/login', req.url))
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons|sw.js|.*\\.(?:svg|png|webp)$).*)'],
}
```

**Optimisation for Phase 2:** add a Supabase *Custom Access Token* auth hook that stamps `role` into `app_metadata`. Middleware then does zero DB round-trips, and RLS helpers can read `auth.jwt()` instead of `profiles`.

### 2.3 Server-side role guard (per-layout, defence in depth)

`lib/auth/guards.ts`:

```ts
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database.types'

type Role = Database['public']['Enums']['user_role']

export async function requireRole(...allowed: Role[]) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('id, role, full_name, phone, is_active')
    .eq('id', user.id).single()

  if (!profile?.is_active) redirect('/login?error=inactive')
  if (!allowed.includes(profile.role)) redirect('/')
  return { user, profile, supabase }
}
```

Used as the first line of `app/shop/layout.tsx`, `app/rider/layout.tsx`, `app/admin/layout.tsx`.

### 2.4 Brand tokens

```css
/* globals.css */
:root {
  --brand-red:  0 66% 47%;   /* #C62828 */
  --brand-gold: 41 65% 50%;  /* #D4A72C */
  --charcoal:   0 0% 14%;    /* #242424 */
  --primary: var(--brand-red);
  --ring:    var(--brand-gold);
}
```

Status colour map (single source of truth in `components/orders/StatusBadge.tsx`): `pending` slate · `assigned` gold · `picked_up` blue · `delivered` green · `failed` amber · `cancelled` red.

---

## 3. Haversine distance & dispatch ranking

`lib/geo/haversine.ts` — pure, dependency-free, used for client-side ranking, ETA labels and map badges. The DB (`nearby_available_riders`) does the *filtering*; this does the *presentation and scoring*.

```ts
export type LatLng = { lat: number; lng: number }

const R_KM = 6371.0088                       // mean Earth radius (IUGG)
const toRad = (d: number) => (d * Math.PI) / 180

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Cheap equirectangular approximation — ~0.1% error at Thingangyun's latitude
 * over <10km. Use when sorting hundreds of markers on every map pan.
 */
export function fastDistanceKm(a: LatLng, b: LatLng): number {
  const x = toRad(b.lng - a.lng) * Math.cos(toRad((a.lat + b.lat) / 2))
  const y = toRad(b.lat - a.lat)
  return Math.hypot(x, y) * R_KM
}

/** Street distance ≈ crow-fly × grid factor. Yangon's block grid ≈ 1.35. */
export const ROAD_FACTOR = 1.35
export const roadKm = (crowKm: number) => crowKm * ROAD_FACTOR

/** Motorbike ETA in minutes; 18 km/h effective in Yangon traffic + handoff buffer. */
export function etaMinutes(crowKm: number, avgKmh = 18, bufferMin = 4) {
  return Math.round((roadKm(crowKm) / avgKmh) * 60 + bufferMin)
}
```

`lib/geo/dispatch.ts` — ranking. Pure distance is the wrong single criterion: a rider 300 m away who is already carrying 3 parcels and 480 000 MMK of COD is a worse choice than one 1.2 km away who is empty.

```ts
import { haversineKm, etaMinutes, type LatLng } from './haversine'

export type RiderCandidate = {
  riderId: string
  fullName: string
  phone: string
  baseArea: string | null
  location: LatLng
  coverageKm: number
  activeOrders: number
  maxActiveOrders: number
  codInHand: number
  codFloatLimit: number
  lastPingAt: string
}

export type RankedRider = RiderCandidate & {
  distanceKm: number
  etaMin: number
  score: number
  withinCoverage: boolean
  sameArea: boolean
  blockedReason?: 'stale_ping' | 'out_of_coverage' | 'at_capacity' | 'cod_limit'
}

const STALE_MS = 10 * 60 * 1000

export type RankOptions = {
  pickup: LatLng
  pickupAreaName?: string | null
  now?: number
  weights?: Partial<typeof DEFAULT_WEIGHTS>
  includeBlocked?: boolean          // dispatcher may want to see, and override
}

const DEFAULT_WEIGHTS = {
  distance: 1.0,     // per km
  load:     0.6,     // per active order
  sameArea: -0.8,    // bonus: rider's base_area === pickup ward
  codLoad:  0.5,     // per 100% of float limit consumed
}

export function rankRiders(
  riders: RiderCandidate[],
  { pickup, pickupAreaName, now = Date.now(), weights, includeBlocked = false }: RankOptions,
): RankedRider[] {
  const w = { ...DEFAULT_WEIGHTS, ...weights }

  const ranked = riders.map<RankedRider>((r) => {
    const distanceKm = haversineKm(pickup, r.location)
    const withinCoverage = distanceKm <= r.coverageKm
    const sameArea = !!pickupAreaName && r.baseArea === pickupAreaName
    const codRatio = r.codFloatLimit > 0 ? r.codInHand / r.codFloatLimit : 0

    let blockedReason: RankedRider['blockedReason']
    if (now - new Date(r.lastPingAt).getTime() > STALE_MS) blockedReason = 'stale_ping'
    else if (!withinCoverage)                              blockedReason = 'out_of_coverage'
    else if (r.activeOrders >= r.maxActiveOrders)           blockedReason = 'at_capacity'
    else if (codRatio >= 1)                                blockedReason = 'cod_limit'

    const score =
      distanceKm * w.distance +
      r.activeOrders * w.load +
      codRatio * w.codLoad +
      (sameArea ? w.sameArea : 0)

    return {
      ...r,
      distanceKm: Math.round(distanceKm * 100) / 100,
      etaMin: etaMinutes(distanceKm),
      score: Math.round(score * 1000) / 1000,
      withinCoverage,
      sameArea,
      blockedReason,
    }
  })

  return ranked
    .filter((r) => includeBlocked || !r.blockedReason)
    .sort((a, b) =>
      (a.blockedReason ? 1 : 0) - (b.blockedReason ? 1 : 0) || a.score - b.score,
    )
}

/** One-click auto-dispatch: the best candidate, or null if the dispatcher must intervene. */
export function pickBestRider(riders: RiderCandidate[], opts: RankOptions): RankedRider | null {
  const [best] = rankRiders(riders, opts)
  return best && !best.blockedReason ? best : null
}
```

Wiring it in the dispatcher assign page (Server Component → RPC → rank → render):

```ts
// app/admin/dispatcher/[orderId]/assign/page.tsx
const supabase = await createClient()
const { data: order } = await supabase.from('orders')
  .select('*, service_areas!dropoff_area_id(name)').eq('id', orderId).single()

const { data: candidates } = await supabase.rpc('nearby_available_riders', {
  p_order_id: orderId, p_limit: 20,
})

const ranked = rankRiders(mapCandidates(candidates ?? []), {
  pickup: { lat: order.pickup_lat, lng: order.pickup_lng },
  pickupAreaName: order.service_areas?.name,
  includeBlocked: true,
})
```

**Pricing** (`lib/pricing.ts`) reuses the same distance:

```ts
export function quoteFee(km: number, s: AppSettings): number {
  const billable = Math.max(0, roadKm(km) - s.free_km)
  return Number(s.base_delivery_fee) + Math.ceil(billable) * Number(s.per_km_fee)
}
export function splitCommission(fee: number, pct: number) {
  const rider = Math.floor((fee * pct) / 100)
  return { rider, platform: fee - rider }   // integer MMK, no rounding leak
}
```

---

## 4. Supabase Realtime strategy

Three distinct channels, chosen per data shape — this is the difference between a dispatch board that stays responsive at 40 riders and one that melts.

| Data | Volume | Mechanism | Why |
|---|---|---|---|
| Order rows (create, assign, status) | ~200/day | `postgres_changes` on `public.orders` | Low volume, needs RLS filtering, needs the row payload. |
| Rider GPS pings | ~40 riders × 6/min | **Presence** on `dispatch:live` | Ephemeral, never queried historically, must not hit the WAL. |
| Job offer push to one rider | bursty | **Broadcast** to `rider:{id}` | Targeted, no table read, survives RLS complexity. |
| Settlement/audit | daily | plain fetch + revalidate | No realtime needed. |

### 4.1 Enable replication

`supabase/migrations/0005_realtime.sql`:

```sql
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_assignments;
alter table public.orders            replica identity full;  -- so `old` is populated on UPDATE
alter table public.order_assignments replica identity full;

-- Broadcast/presence authorisation (Realtime Authorization).
create policy rt_dispatch_read on realtime.messages for select to authenticated
  using (realtime.topic() = 'dispatch:live' and public.is_dispatch()
         or realtime.topic() = 'rider:' || auth.uid()::text
         or (realtime.topic() like 'rider:%' and public.is_dispatch()));

create policy rt_write on realtime.messages for insert to authenticated
  using (true)
  with check (
    (realtime.topic() = 'dispatch:live' and public.auth_role() in ('rider','dispatcher','super_admin'))
    or (realtime.topic() like 'rider:%' and public.is_dispatch())
  );
```

> `postgres_changes` respects RLS only when the client sets a session (`supabase.realtime.setAuth()` after login, which `@supabase/ssr` does on token refresh). Verify this in Phase 4 with a shop account subscribed to `orders` — it must receive **only** its own rows.

### 4.2 Dispatcher: live pending queue

`lib/realtime/useOrderStream.ts`:

```ts
'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database.types'

type Order = Database['public']['Tables']['orders']['Row']

export function useOrderStream(initial: Order[], scope: { statuses?: Order['status'][] } = {}) {
  const [orders, setOrders] = useState(initial)
  const supabase = useRef(createClient()).current

  useEffect(() => {
    const inScope = (o: Order) => !scope.statuses || scope.statuses.includes(o.status)

    const channel = supabase
      .channel('orders-stream')
      .on<Order>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          setOrders((prev) => {
            if (payload.eventType === 'DELETE') {
              return prev.filter((o) => o.id !== (payload.old as Order).id)
            }
            const row = payload.new as Order
            const rest = prev.filter((o) => o.id !== row.id)
            return inScope(row)
              ? [row, ...rest].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
              : rest
          })
        },
      )
      .subscribe(async (status) => {
        // Reconnect gap: WS drops silently on mobile. Re-fetch on every (re)SUBSCRIBE.
        if (status === 'SUBSCRIBED') {
          const { data } = await supabase.from('orders').select('*')
            .in('status', scope.statuses ?? ['pending', 'assigned', 'picked_up'])
            .order('created_at')
          if (data) setOrders(data)
        }
      })

    return () => { void supabase.removeChannel(channel) }
  }, [supabase, scope.statuses?.join(',')])

  return orders
}
```

The **re-fetch on `SUBSCRIBED`** is not optional. Riders ride through dead zones; a channel that silently reconnects without backfilling shows a dispatcher a stale board, and stale boards cause double-assignment.

### 4.3 Rider presence → live map

Rider side (writes presence + a throttled DB heartbeat so `nearby_available_riders` stays accurate):

```ts
'use client'
export function useRiderBeacon(riderId: string, isOnline: boolean) {
  const supabase = useRef(createClient()).current

  useEffect(() => {
    if (!isOnline) return
    const channel = supabase.channel('dispatch:live', {
      config: { presence: { key: riderId } },
    })
    channel.subscribe((s) => { if (s === 'SUBSCRIBED') void channel.track({ riderId, ts: Date.now() }) })

    let lastDbWrite = 0
    const watch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const point = { lat: coords.latitude, lng: coords.longitude, heading: coords.heading }
        void channel.track({ riderId, ...point, ts: Date.now() })     // every fix: cheap
        if (Date.now() - lastDbWrite > 20_000) {                       // DB: max 3/min
          lastDbWrite = Date.now()
          void supabase.rpc('rider_heartbeat', { p_lat: point.lat, p_lng: point.lng, p_online: true })
        }
      },
      console.warn,
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    )

    return () => {
      navigator.geolocation.clearWatch(watch)
      void channel.untrack()
      void supabase.removeChannel(channel)
      void supabase.rpc('rider_heartbeat', { p_lat: 0, p_lng: 0, p_online: false })
    }
  }, [supabase, riderId, isOnline])
}
```

Dispatcher side:

```ts
'use client'
export function useRiderPresence() {
  const [riders, setRiders] = useState<Record<string, RiderPing>>({})
  const supabase = useRef(createClient()).current

  useEffect(() => {
    const channel = supabase.channel('dispatch:live')
    const sync = () => {
      const state = channel.presenceState<RiderPing>()
      setRiders(Object.fromEntries(
        Object.entries(state).map(([key, metas]) => [key, metas.at(-1)!]),
      ))
    }
    channel
      .on('presence', { event: 'sync' },  sync)
      .on('presence', { event: 'join' },  sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [supabase])

  return riders
}
```

Leaflet markers are then updated by mutating `marker.setLatLng()` from a `useEffect` keyed on `riders` — never by re-rendering the map component.

### 4.4 Targeted job offer to a rider

Dispatcher (server action) inserts the offer row and broadcasts:

```ts
await supabase.from('order_assignments').insert({ order_id, rider_id, rank, distance_km })
await supabase.channel(`rider:${rider_id}`)
  .send({ type: 'broadcast', event: 'new_offer', payload: { orderId: order_id, distanceKm, codAmount } })
```

Rider PWA subscribes to `rider:{own id}` and fires a local notification + sound. Because a broadcast can be missed while backgrounded, the offer also lives in `order_assignments` with `expires_at` — the jobs feed reads that table on focus, so the WS is an accelerator, not the source of truth.

### 4.5 Cost / scale guardrails

- One channel per concern, **not** one per order. `orders-stream` + `dispatch:live` + `rider:{id}` = 3 channels max per client.
- Never subscribe to `rider_profiles` via `postgres_changes` — heartbeats would emit ~14k WAL events/day/rider.
- If order volume passes ~5k/day, migrate `orders` from `postgres_changes` to **broadcast-from-database** (`realtime.broadcast_changes()` in an `AFTER` trigger) — it scales per-topic instead of fanning every row change to every listener.

---

## 5. Phase-by-phase execution roadmap

Each phase ends in something demonstrable. Prompt me with the phase name and I'll generate that code.

### Phase 1 — Foundation & data layer  *(~1 week)*
**Generate:** `supabase/migrations/0001–0004`, `seed.sql` (Thingangyun wards: San Pya, Lhay Htaung Kan, Saung Thuma, Thu Mingalar, Ngamoeyeik + `app_settings` 80/20), `types/database.types.ts`, `lib/supabase/{client,server,middleware,admin}.ts`, `middleware.ts`, `lib/auth/guards.ts`, `app/(auth)/*`, shadcn init + brand tokens, base layouts for all four roles.
**Exit criteria:** four seeded accounts each land on their own dashboard; a shop account querying `orders` returns only its rows; a rider cannot `UPDATE` its own `commission_pct_override` (verify with a raw `psql` attempt as that role).

### Phase 2 — Shop order intake  *(~1 week)*
**Generate:** `MapCanvas` + `LocationPicker` (Leaflet, `dynamic(..., { ssr: false })`, OSM tiles, Nominatim reverse geocode with a debounce + attribution), `OrderForm` with zod validation and live fee quote via `/api/orders/quote`, `createOrder` Server Action, `OrderTable`, `StatusTimeline`, shop dashboard KPI tiles, public `/track/[code]`.
**Exit criteria:** a shop creates an order with two map-picked points; the Thingangyun bbox check rejects an out-of-township pin; order appears with a `MGE-YYMMDD-#####` code and quoted fee.

### Phase 3 — Dispatch engine  *(~1.5 weeks)*
**Generate:** `nearby_available_riders` + `assign_order` migrations, `lib/geo/{haversine,dispatch}.ts` with unit tests (fixture: 6 riders around Thingangyun, assert ranking and each `blockedReason`), dispatcher split-view page, `RiderRankList` with distance/ETA/load/COD columns, one-click assign Server Action, `LiveDispatchMap`, unassign + cancel flows.
**Exit criteria:** two browser tabs both click assign on the same order — one succeeds, one gets `order_not_assignable`; rider `availability` flips to `busy` at `max_active_orders`.

### Phase 4 — Rider PWA & proof of delivery  *(~1.5 weeks)*
**Generate:** `manifest.ts` + service worker, `OnlineToggle` + `useRiderBeacon`, nearest-jobs feed from `order_assignments`, job sheet with `tel:` call button and geo intent (`https://www.openstreetmap.org/directions?...` / `geo:` URI), `advance_order` RPC wiring, camera capture → client-side WebP compression → `delivery-proofs` upload → signed-URL preview, earnings screen, `useOrderStream` + `useRiderPresence` + broadcast offers, offline queue for status changes (IndexedDB, replay on reconnect).
**Exit criteria:** installable on an Android phone; full `pending → assigned → picked_up → delivered` cycle from the handset with a photo, dispatcher board updating live; a status tap made offline lands when signal returns; `delivered` without a photo is rejected by the DB constraint, not just the UI.

### Phase 5 — Money: commission, COD settlement, admin  *(~1.5 weeks)*
**Generate:** super-admin rider registration (service-role `createUser` + `rider_profiles` insert with `base_area`/`coverage_km`), shops CRUD, `service_areas` editor with centroid picker, pricing page (base fee, per-km, free km, 80/20 split), `build_settlement` RPC + daily settlement page + approve/mark-paid, `cod_ledger` audit explorer with rider cash-in-hand balances, CSV export, Postgres cron job for nightly settlement drafts, `/admin/audit` order timeline viewer.
**Exit criteria:** a day of deliveries produces a settlement whose `net_due_platform` equals `sum(cod_amount) − sum(rider_commission_amount)` and matches the ledger to the kyat; re-running `build_settlement` is idempotent; changing the split to 70/30 leaves yesterday's settlement untouched.

### Post-MVP backlog
Bulk order CSV import for shops · Viber/SMS customer notifications on `picked_up`/`delivered` · rider batch/multi-drop routing · true route distance via OSRM · Burmese/English i18n toggle · township polygon replacing the bbox · shop-side wallet top-up · rider leaderboard.

---

## Appendix — environment

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=              # server-only, never in a client component
NEXT_PUBLIC_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
NEXT_PUBLIC_NOMINATIM_URL=https://nominatim.openstreetmap.org
NEXT_PUBLIC_DEFAULT_CENTER=16.8409,96.1735   # Thingangyun approx centre
NEXT_PUBLIC_DEFAULT_ZOOM=14
```

**OSM usage policy:** `tile.openstreetmap.org` and public Nominatim are rate-limited and forbid heavy/bulk use. Before launch, either self-host a tile server + Nominatim instance, or use a free-tier provider (MapTiler / Stadia / Geoapify) with a keyed URL. Nominatim requires a `User-Agent` identifying the app and permits **1 req/sec** — debounce reverse geocoding hard and cache results on the shop's pickup point.

```bash
npx supabase gen types typescript --project-id "$PROJECT_ID" --schema public > types/database.types.ts
```

---

## Appendix B — what was verified, and how

Phase 1 ran against `ghcr.io/supabase/postgres:17.6.1.158`. Phase 1b/2 ran against that plus real `postgrest:v14.16` and `gotrue:v2.195.0` behind a minimal Kong stand-in, with the app pointed at it.

| Claim | How it was checked |
|---|---|
| 46 SQL invariants (RLS, state machine, ledger, settlement, storage) | `supabase/tests/*.sql` — all green from a clean DB |
| Assignment race (D6) | two concurrent sessions; loser blocked on the row lock 3s, then `order_not_assignable`; exactly one rider held capacity |
| `anon` cannot read tables | PostgREST returned `42501 permission denied for table orders` |
| `track_order` leaks no PII | payload asserted to contain no phone, street address or rider identity; rendered page grepped for six PII needles |
| Shop isolation through the app | 3 orders in DB, shop dashboard rendered exactly its 1, no other shop's customer names |
| Role provisioning | all four roles created via the real GoTrue admin API landed with the correct `profiles.role`; rider got a `rider_profiles` row automatically |
| Longest-prefix RBAC | `dispatcher` allowed at `/admin/dispatcher`, **denied** at `/admin/super`; `super_admin` allowed at both; shop and rider confined to their own trees |
| Types match the schema | generated by `postgres-meta` from the live DB — 11 tables, 8 enums, 19 functions |
| `haversineKm` agrees with PostGIS | three Thingangyun legs cross-checked against `ST_Distance`, all within 0.5% (worst case: 1° of latitude, 0.48%, where a sphere cannot model the spheroid's flattening) |
| `rankRiders` scoring | 63 unit tests, plus each factor exercised against live data: distance ordering, `at_capacity` on 3/3 parcels, COD float pushing a score 1.626 → 2.101, ward bonus worth exactly −0.8 and correctly failing to rescue a rider 1.4 km further out |
| Dispatch board RBAC | dispatcher gets `/admin/dispatcher` (200) and is denied `/admin/super`; shop and rider bounce to their own homes; the candidates API returns 403 to both a shop and anon |
| Offer / accept flow | 15 SQL assertions: offer stays `pending`, ranks by distance, rider sees only their own offer, decline commits nothing, double-answer refused, accept snapshots 1600/400 of 2000 and expires siblings, expired offer refused, rider cannot forge an offer or answer someone else's, `assign_order_internal` not client-callable |
| Rider lifecycle, live | offer → feed → accept → `picked_up` → `delivered`, with GPS stamped on both checkpoints, ledger `+24500 / −1600`, capacity released, `availability` back to `available` |
| Proof gate | `delivered` with no photo refused with `proof_required`; upload matrix through the real storage-api — assigned rider to own folder **200**, another order **400**, bucket root **400**, different rider **400**, shop owner **400** |
| Offline replay safety | re-sending an identical `delivered` is a no-op (ledger stayed 2 rows / 22,900 Ks, checkpoints stayed 6); a stale `picked_up` fails `illegal_transition` and classifies as `superseded` so the queue drops it instead of retrying forever |
| One-click assign race | two dispatchers, two riders, one order, fired simultaneously through `assign_order`: **B won** with commission 1600, **A lost with the literal string `order_not_assignable: assigned`**, exactly one rider held capacity, one audit row written. That exact string is a test case in `lib/dispatch/errors.test.ts`, closing the loop from DB error to user-facing message |

Types are generated, never hand-written: `npm run db:types`. Note that `RETURNS TABLE` columns come back non-nullable (postgres-meta cannot infer nullability there), so `nearby_available_riders.base_area` is typed `string` but is genuinely nullable when a rider has no `base_area_id` — the ranker treats it defensively.
