-- ============================================================================
--  MINGALAR EXPRESS  ·  0032 — ROOM FOR HLAINGTHARYAR
--
--  The zone rate card puts Hlaing Thar Yar in Zone 1 and its industrial fringe
--  in Zone 2. The geofence does not reach either: 0007 widened
--  `in_service_area()` to Greater Yangon at 96.0500 W, and Hlaingtharyar sits
--  around 96.03 with the township running further west than that.
--
--      in_service_area(16.87, 96.03)  ->  false
--
--  So a shop could pick it from the ward list and the CHECK would refuse the
--  order. West goes to 95.9500, which clears the township and its industrial
--  zone with margin.
--
--  Nothing else moves. Thanlyin (96.26), the Dagons (96.22-96.24), Insein
--  (96.10), Shwepyitha (96.07) and Mingaladon (96.13) were already inside.
--
--  ---------------------------------------------------------------------------
--  WHY THE BOUNDS ARE IN THE FUNCTION BODY AND NOT IN app_settings
--
--  Because a CHECK constraint cannot call a non-immutable function, and reading
--  a table is not immutable. `shops_pickup_in_service_area` and
--  `orders_dropoff_in_service_area` both call this, so the hard geofence has to
--  be baked in and changing it is a migration. `app_settings.bbox_*` is the
--  SOFT copy -- it drives the map viewport and the geocoder, and
--  `coverageSchema` refuses to widen it past these bounds, precisely so nobody
--  can produce a map that accepts a pin the database then refuses.
--
--  Three copies stay in step, deliberately:
--
--      in_service_area()              this file. The hard gate.
--      THINGANGYUN_BBOX               lib/geo/thingangyun.ts. Rejects a pin
--                                     before the round-trip.
--      app_settings.bbox_*            the map, narrowed within the above.
--
--  WIDENING ONLY ADMITS. No existing shop or order can fail a CHECK that has
--  grown, so there is nothing to re-validate and nothing to backfill.
--
--  Forward-only.
-- ============================================================================

create or replace function public.in_service_area(
  p_lat double precision,
  p_lng double precision
) returns boolean
language sql immutable parallel safe
as $$
  select p_lat is not null and p_lng is not null
     and p_lat between 16.7400 and 17.0200   -- S / N
     and p_lng between 95.9500 and 96.3400;  -- W / E  (west was 96.0500)
$$;

comment on function public.in_service_area is
  'Greater Yangon bounding box (16.7400..17.0200 N, 95.9500..96.3400 E). The '
  'hard geofence, called by CHECK constraints on shops and orders -- which is '
  'why the bounds are inline: a CHECK cannot read a table. Widened west in '
  '0032 to reach Hlaingtharyar. A typo guard, not a statement of coverage: '
  'route_areas is the real answer to where we deliver.';

-- The soft copy follows, so the map shows the area the database now accepts.
-- Still inside the function bounds, which is what coverageSchema enforces.
update public.app_settings
   set bbox_west = 95.9500
 where id and bbox_west > 95.9500;
