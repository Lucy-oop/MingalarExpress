-- ============================================================================
--  MINGALAR EXPRESS  ·  0037 — THE DELIVERY ADDRESS NEEDS NO MAP PIN
--
--  0036 made the PICKUP pin optional and said the dropoff would stay required,
--  because "the customer's location is chosen on a map at booking and a delivery
--  with nowhere to go is not a parcel". The second half of that is still true.
--  The first half was wrong about how a shop actually books.
--
--  A shop types a customer's address from a Viber message. Nominatim finds two
--  of six Yangon addresses, so for most parcels the shop was being asked to
--  place a pin on a map for a street it has never visited -- guessing, on the
--  customer's behalf, to satisfy a form. A guessed pin is not more information
--  than no pin. It is worse, because a rider trusts it.
--
--  ---------------------------------------------------------------------------
--  WHAT REPLACES IT: THE AREA, WHICH IS STRONGER
--
--  `orderCreateSchema.dropoffAreaId` is REQUIRED and always was. An area is not
--  a weaker version of a coordinate; for the question that actually matters it
--  is a better answer:
--
--      a bbox pin says   "somewhere inside Greater Yangon"
--      an area says      "South Okkalapa, which Route C visits, priced 4,000"
--
--  Since 0033 the area also carries the FEE, and `resolveAreaRoute` already
--  refuses an area with no zone or no primary route. So every order still names
--  a place we have curated, priced and can dispatch to. That is the invariant
--  the geofence was standing in for.
--
--  Which is why this migration ADDS a constraint while relaxing another: at
--  least one locator must survive. Without it the app's requirement would be
--  the only thing between us and an order that says nothing about where it goes,
--  and `orders_insert_shop` does not check either column.
--
--  ---------------------------------------------------------------------------
--  WHAT THE OPERATION LOSES, and the mitigation
--
--  DRIVE ORDER. `sortRoute` sequences a run by distance from the hub, outward
--  for deliveries. With no coordinate a stop cannot be measured, and 20
--  unmeasurable stops is not a route -- it is a list. This is the real cost of
--  this change and it is larger than anything 0036 gave up.
--
--  The mitigation already exists in the data: `route_areas.stop_order` is a
--  curated per-route sequence of areas, set by the office, and `toJob` already
--  carries it onto every job as `stopOrder`. `sortRoute` now falls back to it
--  when a stop has no coordinates, so an unpinned run is ordered by the
--  office's own ward sequence instead of by order code. Coarser than metres,
--  but it is a real drive order and a human chose it.
--
--  NAVIGATION. A rider with no dropoff pin gets the address, the dropoff note
--  and `customer_phone` -- which is NOT NULL and format-checked. They ring the
--  customer, which is what happens on the doorstep in Yangon regardless.
--
--  REUSED CUSTOMERS STILL CARRY THEIR PIN. `lib/orders/customer-lookup` reads
--  the previous order's coordinates, so a returning customer is booked WITH a
--  point. Only a genuinely new address the geocoder cannot place goes without.
--
--  ---------------------------------------------------------------------------
--  RELAXING ONLY ADMITS. Every existing order has both coordinates and an area,
--  so nothing to backfill and nothing to re-validate.
--
--  Forward-only.
-- ============================================================================

alter table public.orders
  alter column dropoff_lat drop not null,
  alter column dropoff_lng drop not null;

/*
  `in_service_area` opens with `p_lat is not null and p_lng is not null` and so
  returns FALSE for a null pair -- the old constraint would have rejected every
  order booked without a pin. A pin that IS given is still held to the fence.
*/
alter table public.orders
  drop constraint if exists orders_dropoff_in_service_area;

alter table public.orders
  add constraint orders_dropoff_in_service_area
  check (dropoff_lat is null or public.in_service_area(dropoff_lat, dropoff_lng));

-- Half a pin is not a location. Same hole as 0034/0036: a null LATITUDE with a
-- real longitude passes the constraint above on its first branch.
alter table public.orders
  add constraint orders_dropoff_pin_complete
  check ((dropoff_lat is null) = (dropoff_lng is null));

/*
  AND WE MUST KNOW SOMETHING. This is the constraint that keeps the change
  honest: `dropoff_area_id` is nullable and `on delete set null`, so without
  this a parcel could carry no pin AND no area -- nowhere to dispatch it, no
  zone to price it, nothing for the office to work from. The app requires an
  area, but `orders_insert_shop` checks ownership alone and a shop owner can
  POST straight to PostgREST.

  NOT NOT NULL on dropoff_area_id, deliberately: that column is `on delete set
  null`, so making it mandatory would turn "delete a service area" into a hard
  failure against historical orders. This says what is actually needed -- one
  locator, either kind -- and leaves the FK alone.
*/
alter table public.orders
  add constraint orders_dropoff_locatable
  check (dropoff_area_id is not null or dropoff_lat is not null);

comment on column public.orders.dropoff_lat is
  'Where the rider delivers, when anyone knows it precisely. NULL is ordinary: '
  'a shop types an address from a Viber message and most Yangon addresses do '
  'not geocode, so asking for a pin asked the shop to guess. dropoff_area_id '
  'carries where it goes -- curated, priced and dispatchable -- and '
  'orders_dropoff_locatable makes sure at least one of the two is present.';
