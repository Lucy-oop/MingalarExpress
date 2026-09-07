-- ============================================================================
--  MINGALAR EXPRESS  ·  0034 — A SHOP MAY REGISTER WITHOUT A PIN
--
--  Registration used to fail closed. `pickup_lat/lng` were NOT NULL behind a
--  geofence CHECK, the setup form asked for an address in plain text, and the
--  server geocoded it -- so a merchant whose street Nominatim has never heard of
--  could not create a shop at all. Measured on six realistic Yangon addresses,
--  the lookup found two:
--
--      No. 24, Thitsar Road, San Pya Ward, Thingangyun     0 hits
--      Building 5, Zone 3, Hlaingtharyar Industrial        0 hits
--      Shwe Pyi Thar Industrial Zone 4                     0 hits
--      No 7, Thanlyin market road                          0 hits
--
--  Roughly two thirds of merchants dead-ended on the first screen, on the same
--  release that removed waiting for approval. So the pin becomes optional.
--
--  ---------------------------------------------------------------------------
--  NULL, NOT A PLACEHOLDER
--
--  The alternative was to invent a coordinate -- a ward centroid, the hub, the
--  city centre -- and that is strictly worse than nothing. A rider sent to a
--  plausible wrong pin drives there, finds no shop, and rings the office; a
--  rider sent to NULL never gets the job in the first place, because the parcel
--  cannot be booked. One wastes a trip, the other is caught before it starts.
--
--  The seeded ward centroids make the point: every one is flagged
--  VERIFY-CENTROID and `lib/orders/area-match.ts` records Bahan's as 2.2 km out.
--
--  ---------------------------------------------------------------------------
--  WHERE THE BLOCK MOVES TO
--
--  `orders.pickup_lat/lng` stay NOT NULL -- they are the rider's navigation
--  target and there is no honest fallback for them either. So a pinless shop
--  can register, sign in, be seen by the office and set its own pin in Shop
--  settings, but it cannot book until it has one. The block does not disappear;
--  it moves from the first screen a merchant ever sees to a screen they reach
--  with an account, a dashboard and a fixable prompt.
--
--  ---------------------------------------------------------------------------
--  RELAXING ONLY ADMITS
--
--  Every existing shop has a pin and passes the new CHECK unchanged, so there
--  is nothing to backfill and nothing to re-validate. `pickup_geog` is a
--  generated column over st_makepoint, which is strict: a null pair yields a
--  null geography, and the GiST index takes that without complaint.
--
--  Forward-only.
-- ============================================================================

alter table public.shops
  alter column pickup_lat drop not null,
  alter column pickup_lng drop not null;

/*
  THE GEOFENCE, now with a hole exactly the shape of "not known yet".

  `in_service_area` returns FALSE for a null pair rather than null -- it opens
  `p_lat is not null and p_lng is not null` -- so the old constraint would have
  rejected every pinless row. It has to say so explicitly.

  Kept as a CHECK rather than moved to a trigger: this is the line that stops a
  shop outside Greater Yangon, and a CHECK is the one thing a PostgREST client
  cannot talk its way around.
*/
alter table public.shops
  drop constraint if exists shops_pickup_in_service_area;

alter table public.shops
  add constraint shops_pickup_in_service_area
  check (pickup_lat is null or public.in_service_area(pickup_lat, pickup_lng));

/*
  AND NEVER HALF A PIN. One coordinate without the other is not a location, it
  is a bug -- a form that posted lat and dropped lng, a partial update. Without
  this the CHECK above would pass a row with a latitude and no longitude,
  because `pickup_lat is null` is false and `in_service_area(16.8, null)` is
  false... which would fail. It is the reverse case that slips through: null lat
  with a real lng passes on the first branch and stores half a point.
*/
alter table public.shops
  add constraint shops_pickup_pin_complete
  check ((pickup_lat is null) = (pickup_lng is null));

comment on column public.shops.pickup_lat is
  'Where a rider goes to collect. NULL means nobody has established it yet -- '
  'the address text is all we have. A pinless shop can trade in every way '
  'except booking a parcel, because orders.pickup_lat is NOT NULL and there is '
  'no honest default. Set from Shop settings or by the office.';

-- Finding them. A shop with no pin is a shop that cannot book, so both the
-- office queue and the merchant's own dashboard need to spot one cheaply.
create index if not exists shops_no_pin_idx
  on public.shops (created_at desc)
  where pickup_lat is null;
