-- ============================================================================
--  MINGALAR EXPRESS  ·  0036 — A PARCEL MAY BE BOOKED WITHOUT A PICKUP PIN
--
--  0034 made `shops.pickup_lat/lng` nullable so a merchant whose street the
--  geocoder has never heard of could still register. It said this, explicitly:
--
--      `orders.pickup_lat/lng` stay NOT NULL -- they are the rider's
--      navigation target and there is no honest fallback for them either. So a
--      pinless shop can register, sign in, be seen by the office and set its
--      own pin in Shop settings, but it cannot book until it has one.
--
--  That is the line this migration moves, deliberately and with a cost. The
--  block did not disappear when it moved to the booking page; it just moved
--  somewhere better lit. A merchant who cannot make the geocoder find their
--  street still could not sell anything.
--
--  ---------------------------------------------------------------------------
--  WHAT THE RIDER LOSES, said plainly
--
--  Turn-by-turn navigation to that shop. Nothing else. They still get:
--
--    the pickup ADDRESS       typed by the owner, who knows it
--    the pickup NOTE          "near the big mall, green shutter"
--    the shop's PHONE         one tap, and the collection card already shows it
--
--  Which is how collection actually works in Yangon: you drive to the ward and
--  you ring the shop. A wrong pin is worse than no pin, and the alternative on
--  offer was a ward centroid -- every one flagged VERIFY-CENTROID in the seed,
--  Bahan's 2.2 km out.
--
--  THE ROUTING LAYER WAS ALREADY BUILT FOR THIS, which is what makes the change
--  small. `sortRoute` measures `j.destination ? haversineKm(...) : null` and
--  sorts unmeasurable stops to the end of their own group -- its comment says
--  "a rider must never lose a stop to bad data". `planCollections` shows a
--  group with no point without a Directions link rather than with a wrong one.
--  `getRiderFeed` already skips non-finite coordinates when building
--  `pickupPoints`. None of that is new work; it was written for bad data and
--  now has a legitimate case.
--
--  ---------------------------------------------------------------------------
--  THE DROPOFF STAYS REQUIRED
--
--  `dropoff_lat/lng` are untouched and still NOT NULL behind
--  `orders_dropoff_in_service_area`. The customer's location is chosen on a map
--  by the shop at booking time, from a form that already has it -- there is no
--  equivalent hole to fill, and a delivery with nowhere to go is not a parcel.
--
--  ---------------------------------------------------------------------------
--  WHAT DEGRADES RATHER THAN BREAKS
--
--  `pickup_geog` is generated from st_makepoint, which is strict, so a null
--  pair yields a null geography. Every consumer is a PostGIS distance:
--
--    assign_order      route_distance_km = st_distance(pickup_geog, dropoff_geog)
--                      -> NULL. The column is `numeric(6,2) check (>= 0)`, no
--                         NOT NULL, and the check passes for NULL.
--    nearby_riders     orders by `current_geog <-> pickup_geog`; NULLs sort last
--                      and this belongs to the retired offer engine anyway.
--
--  So the analytics figure goes blank for those parcels. It is dispatch-quality
--  analytics, per the column's own comment -- not money, not a gate.
--
--  RELAXING ONLY ADMITS. Every existing order has a pin and passes the new
--  CHECK unchanged: nothing to backfill, nothing to re-validate.
--
--  Forward-only.
-- ============================================================================

alter table public.orders
  alter column pickup_lat drop not null,
  alter column pickup_lng drop not null;

/*
  `in_service_area` returns FALSE for a null pair rather than null -- it opens
  with `p_lat is not null and p_lng is not null` -- so the old constraint would
  have rejected every pinless order. It has to say so explicitly.

  Still a CHECK rather than a trigger: this is the line that stops a parcel
  being collected from outside Greater Yangon, and a CHECK is the one thing a
  PostgREST client cannot talk its way around.
*/
alter table public.orders
  drop constraint if exists orders_pickup_in_service_area;

alter table public.orders
  add constraint orders_pickup_in_service_area
  check (pickup_lat is null or public.in_service_area(pickup_lat, pickup_lng));

/*
  AND NEVER HALF A PIN, for the same reason 0034 added it to shops: one
  coordinate without the other is not a location. Note which way the hole runs
  -- a null LATITUDE with a real longitude passes the constraint above on its
  first branch, so without this it would store half a point.
*/
alter table public.orders
  add constraint orders_pickup_pin_complete
  check ((pickup_lat is null) = (pickup_lng is null));

comment on column public.orders.pickup_lat is
  'Where the rider drives to collect, copied from the shop at booking. NULL '
  'when the shop has no pin -- the rider works from pickup_address, pickup_note '
  'and the shop phone instead, and gets no Directions link. Nullable since '
  '0036 so a merchant the geocoder cannot place is not shut out of selling.';
