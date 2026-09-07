-- ============================================================================
--  MINGALAR EXPRESS  ·  0033 — THE CUSTOMER PRICE MOVES TO A ZONE
--
--  `routes.per_parcel_fee` has been doing two jobs at once: what the shop is
--  charged, and the revenue side of the rider-pay margin check. The rate card
--  is now two zones -- 4,000 Ks and 5,000 Ks -- and a route bundles several
--  townships, so a route spanning both zones cannot express two prices.
--
--  So the customer price becomes a property of the ZONE, and routes keep doing
--  what only they can: run planning, stop order, and rider pay through
--  route_pay_tiers and quote_trip_pay. Nothing about rider economics moves.
--
--  ---------------------------------------------------------------------------
--  A TABLE, NOT CONSTANTS, because the rate card has already changed once
--
--  Baking 45 townships and two prices into a migration means the next revision
--  is another migration and a deploy. Zones are configuration: the fee, the
--  promised days and the area assignment are all editable by a Super Admin.
--
--  ---------------------------------------------------------------------------
--  AN AREA WITH NO ZONE CANNOT BE QUOTED, AND SAYS SO
--
--  No fallback to the route price. A silent wrong price produces an invoice
--  argument weeks later and a merchant who does not trust the number; a blocked
--  booking produces a phone call today and a fix. `getAreaRoutes` therefore
--  omits an unzoned area from the booking list entirely -- the same rule it
--  already applies to an area with no primary route -- and `createOrder`
--  refuses one as a backstop.
--
--  Which is why EVERY area is assigned below. An unzoned area is a bug, not a
--  state to design around.
--
--  ---------------------------------------------------------------------------
--  WHAT THIS MIGRATION CANNOT DO
--
--  The 21 new townships have no `route_areas` row, so they are priceable but
--  not yet dispatchable -- nothing can plan a run to Thanlyin until the office
--  says which route visits it, and that is an operational decision, not one to
--  guess in SQL. They will not appear in the booking list until mapped. The
--  zones screen surfaces exactly which ones are waiting.
--
--  Forward-only.
-- ============================================================================

set check_function_bodies = off;

-- ----------------------------------------------------------------------------
-- 1. The zones
-- ----------------------------------------------------------------------------

create table if not exists public.delivery_zones (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (length(trim(code)) between 1 and 20),
  name           text not null check (length(trim(name)) between 1 and 80),
  name_mm        text,
  -- What the CUSTOMER pays per parcel. Never what the rider is paid.
  fee            bigint not null check (fee >= 0 and fee <= 1000000),
  -- The promise on the rate card. Informational today: nothing schedules
  -- against it, and a `promised_by` on orders would be the honest way to hold
  -- the business to it. Stored so the number has one home.
  delivery_days  smallint not null default 3 check (delivery_days between 1 and 30),
  sort_order     smallint not null default 100,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.delivery_zones is
  'What a customer pays to deliver into a group of areas. The rate card. '
  'Routes still own run planning and rider pay -- a zone is a price, not a run.';
comment on column public.delivery_zones.fee is
  'Per parcel, charged to the shop. Copied onto orders.delivery_fee at booking '
  'so a later rate change never rewrites a parcel that has already been quoted.';

create trigger delivery_zones_touch before update on public.delivery_zones
for each row execute function public.tg_touch_updated_at();

/*
  RLS ON, READ BY ANYONE SIGNED IN. A shop needs the fee to see a quote before
  it books, and the join runs under the shop's own session. Writes are admin
  only, exactly like routes and route_pay_tiers.

  Not optional either way: rls_smoke asserts every table in `public` has RLS
  enabled, and it caught schema_migrations arriving without it in 0030.
*/
alter table public.delivery_zones enable row level security;

create policy zones_read_all on public.delivery_zones
  for select to authenticated using (true);

create policy zones_write_admin on public.delivery_zones
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

/*
  GRANTS, and they are not optional for a new table. 0001's
  `grant ... on all tables in schema public` was a one-shot over the tables that
  existed then -- it does not follow tables added later, which is why 0007 had to
  grant routes explicitly. Without this an admin's UPDATE fails on privilege
  before RLS is ever consulted.
*/
grant select, insert, update, delete on public.delivery_zones to authenticated;
grant all    on public.delivery_zones to service_role;
revoke all   on public.delivery_zones from anon;

insert into public.delivery_zones (code, name, name_mm, fee, delivery_days, sort_order)
values
  ('ZONE_1', 'Zone 1 — inner Yangon', 'ဇုန် ၁', 4000, 3, 10),
  ('ZONE_2', 'Zone 2 — outer and industrial', 'ဇုန် ၂', 5000, 3, 20)
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Every area belongs to one
-- ----------------------------------------------------------------------------

alter table public.service_areas
  -- RESTRICT, not SET NULL: deleting a zone that still prices areas would
  -- silently make every one of them unbookable. Reassign them first.
  add column if not exists zone_id uuid references public.delivery_zones(id) on delete restrict;

create index if not exists service_areas_zone_idx on public.service_areas (zone_id);

-- ----------------------------------------------------------------------------
-- 3. The 21 townships the rate card names and the database did not have
--
--  THEY ARRIVE SWITCHED OFF, and that is the whole subtlety of this section.
--
--  A price is not a service. These townships have a zone, so they can be
--  quoted -- but no `route_areas` row, so nothing can plan a run to them, work
--  out a stop order or pay a rider for the trip. Which route visits Thanlyin is
--  an operational decision for the office, not one to guess in SQL.
--
--  `is_active = false` is the honest name for that state, and it also preserves
--  an invariant worth keeping: `route_flow.sql` R2b asserts that every ACTIVE
--  area has a primary route and therefore a price. Inserting 21 active,
--  unrouted areas would have broken it -- and the right response to that test
--  failing is not to relax it. It is catching exactly what it was written for.
--
--  The zones screen lists these by name as waiting, so switching one on is a
--  deliberate act by someone who has just mapped it to a route.
--
--  `centroid` and `boundary` stay null -- both are nullable, nothing reads them
--  for pricing or dispatch, and inventing coordinates for a township would put
--  a wrong pin on a map with no way to tell it from a right one.
--
--  Names are matched against what is already there. Your card spells Kamayut
--  "Kamaryut" and Kyauktada plainly; both already exist (as 'Kamayut' and
--  'Kyauktada / Sule') and `name` is UNIQUE, so they are reused rather than
--  duplicated -- and their zone is set in section 4 like every other area's.
-- ----------------------------------------------------------------------------

insert into public.service_areas (name, name_mm, kind, sort_order, is_active)
values
  -- Zone 1, inner Yangon
  ('Thingangyun',            'သင်္ဃန်းကျွန်း',        'township', 110, false),
  ('Dawbon',                 'ဒေါပုံ',               'township', 111, false),
  ('Pabedan',                'ပန်းဘဲတန်း',            'township', 112, false),
  ('Lanmadaw',               'လမ်းမတော်',            'township', 113, false),
  ('Latha',                  'လသာ',                 'township', 114, false),
  ('Ahlone',                 'အလုံ',                 'township', 115, false),
  ('Sanchaung',              'စမ်းချောင်း',           'township', 116, false),
  ('Mayangone',              'မရမ်းကုန်း',            'township', 117, false),
  ('Hlaing',                 'လှိုင်',                'township', 118, false),
  ('Insein',                 'အင်းစိန်',              'township', 119, false),
  ('Hlaingtharyar',          'လှိုင်သာယာ',            'township', 120, false),
  ('Shwepyitha',             'ရွှေပြည်သာ',            'township', 121, false),
  ('Dagon',                  'ဒဂုံ',                  'township', 122, false),
  ('Thingangyun Industrial', 'သင်္ဃန်းကျွန်း စက်မှုဇုန်', 'ward',     123, false),
  -- Zone 2, outer and industrial
  ('Thanlyin',                    'သန်လျင်',                  'township', 210, false),
  ('Shwe Pyi Thar (extended)',    'ရွှေပြည်သာ (အပြင်ဘက်)',     'ward',     211, false),
  ('Shwe Pyi Thar Industrial',    'ရွှေပြည်သာ စက်မှုဇုန်',      'ward',     212, false),
  ('North Dagon (extended)',      'ဒဂုံမြောက် (အပြင်ဘက်)',     'ward',     213, false),
  ('South Dagon (extended)',      'ဒဂုံတောင် (အပြင်ဘက်)',      'ward',     214, false),
  ('Dagon Seikkan (extended)',    'ဒဂုံဆိပ်ကမ်း (အပြင်ဘက်)',   'ward',     215, false),
  ('Hlaing Thar Yar (extended)',  'လှိုင်သာယာ (အပြင်ဘက်)',     'ward',     216, false)
on conflict (name) do nothing;

-- ----------------------------------------------------------------------------
-- 4. Assign them
--
--  Zone 2 is named explicitly and everything else is Zone 1 -- including the 24
--  wards seeded before the rate card existed, which are all inner-east Yangon.
--  Written this way round so a ward added later without a zone shows up as a
--  bug on the zones screen rather than being quietly priced as Zone 1.
-- ----------------------------------------------------------------------------

update public.service_areas s
   set zone_id = z.id
  from public.delivery_zones z
 where z.code = 'ZONE_2'
   and s.zone_id is null
   and s.name in (
     'Thanlyin',
     'Shwe Pyi Thar (extended)',
     'Shwe Pyi Thar Industrial',
     'North Dagon (extended)',
     'South Dagon (extended)',
     'Dagon Seikkan (extended)',
     'Hlaing Thar Yar (extended)'
   );

update public.service_areas s
   set zone_id = z.id
  from public.delivery_zones z
 where z.code = 'ZONE_1'
   and s.zone_id is null;

do $$
declare n int;
begin
  select count(*) into n from public.service_areas where zone_id is null;
  if n > 0 then
    raise exception 'zone backfill missed % area(s)', n;
  end if;
end $$;

/*
  AND NOW IT CANNOT HAPPEN AGAIN.

  "An area with no zone cannot be quoted" is a rule the application enforces in
  `toAreaRoute`, and an unzoned area would simply vanish from the booking
  dropdown -- which is refusal, but quiet refusal: the merchant sees a township
  missing and the office never learns why. NOT NULL makes the state
  unrepresentable instead, so the failure lands on the admin who created the
  area, at the moment they create it, which is the only place it can be fixed.

  This is why `saveArea` gains a required zone selector in the same change: the
  one app path that inserts an area would otherwise start failing on a
  constraint violation with no field to blame.

  Safe here because the two backfills above leave nothing null, and the check
  above has already said so with a better message than Postgres would.
*/
alter table public.service_areas alter column zone_id set not null;

comment on column public.service_areas.zone_id is
  'The rate the customer is charged to deliver here. NOT NULL on purpose: an '
  'unzoned area cannot be priced, and would disappear from the booking list '
  'without telling anyone. Routes still decide which run carries it.';
