-- ============================================================================
--  MINGALAR EXPRESS — SEED (local development only)
--
--  Creates the four role accounts named in the Phase 1 exit criteria, the
--  Thingangyun ward list, one shop, three riders and two pending orders.
--
--  Password for every seeded account: mingalar123
--
--  !! WARD CENTROIDS BELOW ARE UNVERIFIED PLACEHOLDERS !!
--  They are plausible points inside the township bbox, good enough to make the
--  map and the distance ranking work in dev. Replace every one of them with
--  surveyed coordinates (or, better, a real boundary polygon from OSM) before
--  this touches production. Search: `VERIFY-CENTROID`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Auth users. raw_app_meta_data.role is what tg_on_auth_user_created trusts;
-- it is service-role-only in a live project, which is why it is safe.
-- ----------------------------------------------------------------------------

-- IMPORTANT: every one of GoTrue's token columns must be '' and never NULL.
-- GoTrue scans them into non-nullable Go strings, so a single NULL makes
-- sign-in fail with the famously unhelpful "Database error querying schema" --
-- while admin user creation still works, which makes it look like a password
-- problem. `reauthentication_token` is the one everybody forgets.
-- Verified against gotrue v2.195.0.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, email_change, phone_change, phone_change_token,
  reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('mingalar123', extensions.gen_salt('bf')),
  now(),
  jsonb_build_object('provider','email','providers',array['email'],'role',u.app_role),
  jsonb_build_object('full_name', u.full_name, 'phone', u.phone),
  now(), now(), '', '', '', '', '', '', '', ''
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'admin@mingalar.test',    'super_admin', 'Ko Aung (Super Admin)', '+959770000001'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'dispatch@mingalar.test', 'dispatcher',  'Ma Hnin (Dispatcher)',  '+959770000002'),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'shop@mingalar.test',     'shop_owner',  'San Pya Mini Mart',     '+959770000003'),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'rider1@mingalar.test',   'rider',       'Zaw Zaw',               '+959770000011'),
  ('55555555-5555-5555-5555-555555555555'::uuid, 'rider2@mingalar.test',   'rider',       'Thiha',                 '+959770000012'),
  ('66666666-6666-6666-6666-666666666666'::uuid, 'rider3@mingalar.test',   'rider',       'Myo Min',               '+959770000013')
) as u(id, email, app_role, full_name, phone)
on conflict (id) do nothing;

-- The signup trigger inserted profiles with role + name. Backfill the phone
-- (kept nullable at signup precisely so it never collides).
update public.profiles p
   set phone = u.raw_user_meta_data ->> 'phone'
  from auth.users u
 where u.id = p.id and p.phone is null;


-- ----------------------------------------------------------------------------
-- Thingangyun wards.  VERIFY-CENTROID on every row below.
-- ----------------------------------------------------------------------------

-- zone_id is NOT NULL since 0033: an area with no zone cannot be priced. Every
-- ward below is inner-east Yangon, so all eight are Zone 1. The VALUES rows are
-- untouched; the zone is joined on once rather than repeated 8 times.
insert into public.service_areas (name, name_mm, sort_order, centroid, zone_id)
select v.*, (select id from public.delivery_zones where code = 'ZONE_1')
  from (values
  ('San Pya',          'စံပြ',            10, extensions.st_point(96.1690, 16.8480)::extensions.geography),
  ('Lhay Htaung Kan',  'လှေတောင်ကန်',      20, extensions.st_point(96.1820, 16.8395)::extensions.geography),
  ('Saung Thuma',      'စောင့်သုမ',        30, extensions.st_point(96.1610, 16.8330)::extensions.geography),
  ('Thu Mingalar',     'သုမင်္ဂလာ',        40, extensions.st_point(96.1755, 16.8560)::extensions.geography),
  ('Kyaung Kone',      'ကျောင်းကုန်း',     50, extensions.st_point(96.1880, 16.8500)::extensions.geography),
  ('Ngamoeyeik',       'ငမိုးရိပ်',        60, extensions.st_point(96.2050, 16.8620)::extensions.geography),
  ('Thitsar',          'သစ္စာ',           70, extensions.st_point(96.1595, 16.8620)::extensions.geography),
  ('Yadanar',          'ရတနာ',            80, extensions.st_point(96.1930, 16.8280)::extensions.geography)
) as v(name, name_mm, sort_order, centroid)
on conflict (name) do nothing;


-- ----------------------------------------------------------------------------
-- Townships served by Routes A–D (migration 0007).
--
-- `kind = 'township'` separates these from the eight Thingangyun WARDS above:
-- only townships belong in route_areas.
--
-- !! VERIFY-CENTROID ON EVERY ROW !! These are plausible points inside each
-- township, good enough to make the map, the stop list and distance sorting
-- work in dev. Not survey data. Replace before production.
-- ----------------------------------------------------------------------------

-- All Zone 1. The rate card puts the "(extended)" pockets of North Dagon, South
-- Dagon, Dagon Seikkan and Shwe Pyi Thar in Zone 2, but those are separate area
-- rows created by 0033 -- none of the townships below is one of them.
insert into public.service_areas (name, name_mm, sort_order, kind, centroid, zone_id)
select v.*, (select id from public.delivery_zones where code = 'ZONE_1')
  from (values
  -- Route A · Downtown
  ('Tamwe',              'တာမွေ',              110, 'township', extensions.st_point(96.1650, 16.7900)::extensions.geography),
  ('Mingalar Taungnyunt','မင်္ဂလာတောင်ညွှန့်',   120, 'township', extensions.st_point(96.1560, 16.7870)::extensions.geography),
  ('Pazundaung',         'ပုဇွန်တောင်',         130, 'township', extensions.st_point(96.1620, 16.7810)::extensions.geography),
  ('Botahtaung',         'ဗိုလ်တထောင်',         140, 'township', extensions.st_point(96.1700, 16.7740)::extensions.geography),
  ('Kyauktada / Sule',   'ကျောက်တံတား / ဆူးလေ', 150, 'township', extensions.st_point(96.1590, 16.7770)::extensions.geography),
  -- Route B · West
  ('Yankin',             'ရန်ကင်း',             210, 'township', extensions.st_point(96.1620, 16.8460)::extensions.geography),
  ('Bahan',              'ဗဟန်း',               220, 'township', extensions.st_point(96.1530, 16.8050)::extensions.geography),
  ('Kamayut',            'ကမရွတ်',              230, 'township', extensions.st_point(96.1290, 16.8250)::extensions.geography),
  ('Hledan',             'လှည်းတန်း',            240, 'township', extensions.st_point(96.1350, 16.8290)::extensions.geography),
  -- Route C · North
  ('South Okkalapa',     'တောင်ဥက္ကလာ',          310, 'township', extensions.st_point(96.1950, 16.8300)::extensions.geography),
  ('North Okkalapa',     'မြောက်ဥက္ကလာ',         320, 'township', extensions.st_point(96.1830, 16.8830)::extensions.geography),
  ('Mingaladon',         'မင်္ဂလာဒုံ',           330, 'township', extensions.st_point(96.1300, 16.9200)::extensions.geography),
  -- Route D · East
  ('North Dagon',        'မြောက်ဒဂုံ',           410, 'township', extensions.st_point(96.2200, 16.9150)::extensions.geography),
  ('East Dagon',         'အရှေ့ဒဂုံ',            420, 'township', extensions.st_point(96.2650, 16.8900)::extensions.geography),
  ('South Dagon',        'တောင်ဒဂုံ',            430, 'township', extensions.st_point(96.2450, 16.8500)::extensions.geography),
  ('Dagon Seikkan',      'ဒဂုံဆိပ်ကမ်း',         440, 'township', extensions.st_point(96.3000, 16.8300)::extensions.geography)
) as v(name, name_mm, sort_order, kind, centroid)
on conflict (name) do nothing;


-- ----------------------------------------------------------------------------
-- Route membership. `stop_order` is the running order OUT from Thingangyun
-- Base, nearest first, and doubles as the rider's manifest ordering.
--
-- Joined on natural keys (route code, township name) rather than hard-coded
-- UUIDs so re-running after a route is renamed does not silently create
-- orphaned mappings.
-- ----------------------------------------------------------------------------

-- Thingangyun's own eight wards, on TWO routes each:
--
--   ROUTE_LOCAL  is_primary = true   the default home for a local parcel
--   ROUTE_A      is_primary = false  a bonus drop on the way downtown
--
-- The partial unique index route_areas_primary_uk allows exactly this: one
-- default route per area, any number of additional ones. stop_order 1..8 puts
-- the local wards ahead of Tamwe (10) on Route A, because they are passed on the
-- way out of the township.
insert into public.route_areas (route_id, area_id, stop_order, is_primary)
select r.id, a.id, v.stop_order, v.is_primary
  from (values
    ('ROUTE_LOCAL', 'San Pya',          10, true),
    ('ROUTE_LOCAL', 'Lhay Htaung Kan',  20, true),
    ('ROUTE_LOCAL', 'Saung Thuma',      30, true),
    ('ROUTE_LOCAL', 'Thu Mingalar',     40, true),
    ('ROUTE_LOCAL', 'Kyaung Kone',      50, true),
    ('ROUTE_LOCAL', 'Ngamoeyeik',       60, true),
    ('ROUTE_LOCAL', 'Thitsar',          70, true),
    ('ROUTE_LOCAL', 'Yadanar',          80, true),
    ('ROUTE_A',     'San Pya',           1, false),
    ('ROUTE_A',     'Lhay Htaung Kan',   2, false),
    ('ROUTE_A',     'Saung Thuma',       3, false),
    ('ROUTE_A',     'Thu Mingalar',      4, false),
    ('ROUTE_A',     'Kyaung Kone',       5, false),
    ('ROUTE_A',     'Ngamoeyeik',        6, false),
    ('ROUTE_A',     'Thitsar',           7, false),
    ('ROUTE_A',     'Yadanar',           8, false)
  ) as v(route_code, area_name, stop_order, is_primary)
  join public.routes        r on r.code = v.route_code
  join public.service_areas a on a.name = v.area_name
on conflict (route_id, area_id) do nothing;

insert into public.route_areas (route_id, area_id, stop_order, is_primary)
select r.id, a.id, v.stop_order, true
  from (values
    -- Route A · Blue · Downtown
    ('ROUTE_A', 'Tamwe',               10),
    ('ROUTE_A', 'Mingalar Taungnyunt', 20),
    ('ROUTE_A', 'Pazundaung',          30),
    ('ROUTE_A', 'Botahtaung',          40),
    ('ROUTE_A', 'Kyauktada / Sule',    50),
    -- Route B · Green · West
    ('ROUTE_B', 'Yankin',              10),
    ('ROUTE_B', 'Bahan',               20),
    ('ROUTE_B', 'Kamayut',             30),
    ('ROUTE_B', 'Hledan',              40),
    -- Route C · Orange · North
    ('ROUTE_C', 'South Okkalapa',      10),
    ('ROUTE_C', 'North Okkalapa',      20),
    ('ROUTE_C', 'Mingaladon',          30),
    -- Route D · Red · East
    ('ROUTE_D', 'North Dagon',         10),
    ('ROUTE_D', 'East Dagon',          20),
    ('ROUTE_D', 'South Dagon',         30),
    ('ROUTE_D', 'Dagon Seikkan',       40)
  ) as v(route_code, area_name, stop_order)
  join public.routes        r on r.code = v.route_code
  join public.service_areas a on a.name = v.area_name
on conflict (route_id, area_id) do nothing;


-- ----------------------------------------------------------------------------
-- Shop
-- ----------------------------------------------------------------------------

-- Approved on purpose (0026): the seed represents shops that are already
-- trading, and the grandfathering in the migration cannot reach rows the seed
-- inserts afterwards. A seeded shop left unapproved cannot book, and every
-- order fixture below would fail for a reason that has nothing to do with the
-- test.
insert into public.shops (id, owner_id, name, phone, area_id, pickup_address, pickup_lat, pickup_lng, pickup_note,
                          goods_type, approved_at)
select
  'aaaaaaaa-0000-0000-0000-000000000001',
  '33333333-3333-3333-3333-333333333333',
  'San Pya Mini Mart',
  '+959770000003',
  (select id from public.service_areas where name = 'San Pya'),
  'No. 24, Thitsar Road, San Pya Ward, Thingangyun, Yangon',
  16.8478, 96.1693,
  'Green shutter next to the tea shop. Ask for Ma Su.',
  'Groceries and household goods',
  now()
on conflict (id) do nothing;


-- ----------------------------------------------------------------------------
-- Riders. rider_profiles rows already exist (created by the signup trigger for
-- role='rider'); this fills in area, radius and a live position.
-- ----------------------------------------------------------------------------

update public.rider_profiles r set
  base_area_id  = a.id,
  coverage_km   = v.coverage,
  vehicle_plate = v.plate,
  is_online     = true,
  availability  = 'available',
  current_lat   = v.lat,
  current_lng   = v.lng,
  last_ping_at  = now()
from (values
  -- ~350 m from the shop: the obvious first pick
  ('44444444-4444-4444-4444-444444444444'::uuid, 'San Pya',         5.0, 16.8451, 96.1706, '9J/1234'),
  -- ~1.6 km away, different ward
  ('55555555-5555-5555-5555-555555555555'::uuid, 'Lhay Htaung Kan', 5.0, 16.8390, 96.1815, '9K/5678'),
  -- 4.04 km away with a 3 km radius: deliberately OUT of coverage
  ('66666666-6666-6666-6666-666666666666'::uuid, 'Ngamoeyeik',      3.0, 16.8625, 96.2040, '9L/9012')
) as v(id, area, coverage, lat, lng, plate)
join public.service_areas a on a.name = v.area
where r.id = v.id;


-- ----------------------------------------------------------------------------
-- Two pending orders for the dispatcher queue
-- ----------------------------------------------------------------------------

-- The fee and the COD total are DERIVED, not written down.
--
-- Before migration 0010 these rows carried hand-written fees from the old
-- distance model (2,000 and 2,600) for two wards whose route charges 2,500. The
-- seed was creating orders the application itself could no longer produce, which
-- is the worst kind of fixture: every test passed while every number was wrong.
--
-- So the fee comes from the same place createOrder() reads it — the primary
-- route for the destination area — and cod_amount is computed from it. Reprice a
-- route and this seed follows; it cannot drift again.
--
-- `v.goods` is the value of the parcel's contents. cod_amount is goods + fee
-- when the customer pays the fee (see the column comment on orders.cod_amount in
-- 0001), which is why the two are not the same number.
insert into public.orders (
  shop_id, pickup_address, pickup_lat, pickup_lng, pickup_contact,
  customer_name, customer_phone, dropoff_address, dropoff_area_id, dropoff_lat, dropoff_lng, dropoff_note,
  parcel_desc, parcel_weight_g, payment_method, cod_amount, delivery_fee, route_id, created_by
)
select
  s.id, s.pickup_address, s.pickup_lat, s.pickup_lng, s.phone,
  v.cust, v.phone, v.addr,
  a.id,
  v.lat, v.lng, v.note,
  v.parcel, v.grams, v.pay::public.payment_method,
  case when v.pay = 'cod' then v.goods + r.per_parcel_fee else 0 end,
  r.per_parcel_fee,
  r.id,
  '33333333-3333-3333-3333-333333333333'
from public.shops s
cross join (values
  ('Daw Khin Myo', '+959791234567', 'No. 7, Baho Street, Lhay Htaung Kan Ward, Thingangyun',
   'Lhay Htaung Kan', 16.8402, 96.1808, 'Blue gate, 2nd floor, ring twice',
   '2x instant coffee cartons', 1800, 'cod', 22500),
  ('U Tin Maung',   '+959795550101', 'Bldg C, Room 402, Yadanar Housing, Thingangyun',
   'Yadanar', 16.8291, 96.1922, 'Call on arrival, lift is out',
   'Phone accessories (fragile)', 400, 'prepaid', 0)
) as v(cust, phone, addr, area, lat, lng, note, parcel, grams, pay, goods)
join public.service_areas a on a.name = v.area
-- An INNER join on purpose: an area with no primary route cannot be priced, so
-- a seeded order for one would be an order the app could never have created.
-- Better to seed nothing and notice than to seed an unroutable parcel.
join public.route_areas ra on ra.area_id = a.id and ra.is_primary
join public.routes      r  on r.id = ra.route_id
where s.id = 'aaaaaaaa-0000-0000-0000-000000000001';


-- ----------------------------------------------------------------------------
-- Settings: confirm the 80/20 split and the OSM dev map provider
-- ----------------------------------------------------------------------------

update public.app_settings set
  brand_name           = 'Mingalar Express',
  order_code_prefix    = 'MGE',
  support_phone        = '+959770000000',
  rider_commission_pct = 80.00,
  base_delivery_fee    = 1500,
  per_km_fee           = 300,
  free_km              = 2.0,
  map_provider         = 'osm',
  tile_url_template    = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tile_attribution     = '&copy; OpenStreetMap contributors',
  geocoder_provider    = 'nominatim',
  geocoder_base_url    = 'https://nominatim.openstreetmap.org'
where id;
