-- ============================================================================
--  MINGALAR EXPRESS  ·  0025 — ONE VISIT TO THE SHOP
--
--  A shop books ten parcels and a dispatcher loads all ten onto one run. The
--  rider makes ONE stop at that shop and ten stops at ten customers -- but the
--  system models ten independent parcels that happen to share an address, so
--  recording the collection meant opening ten job pages and pressing "I HAVE
--  THE PARCEL" ten times, standing at one counter on a phone with two bars.
--
--  `advance_order` takes a scalar id and there is no bulk path on the rider
--  side, so this adds one. It is a loop over the SAME function rather than a
--  reimplementation: every guard, every ledger line and every audit row stays
--  exactly where it was, and there is no second copy of the state machine to
--  drift.
--
--  ALL OR NOTHING. One statement, one transaction: ten parcels advance together
--  or none does. A partial armful is the thing the rider cannot see and cannot
--  correct -- they would leave the shop believing they had ten.
--
--  It also fixes a leak the collection work uncovered; see part 2.
--
--  Forward-only.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. advance_orders — the whole armful at once
-- ----------------------------------------------------------------------------

create or replace function public.advance_orders(
  p_order_ids uuid[],
  p_to        public.order_status,
  p_reason    text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n  integer := 0;
begin
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'no_orders' using errcode = '22023',
      hint = 'Pass at least one order id.';
  end if;

  -- A cap, because this is a rider's phone posting an array it built from a
  -- screen. A run is bounded by routes.max_parcels_per_trip (60 by default);
  -- anything an order of magnitude past that is a bug or a bad actor, not a
  -- morning's work.
  if array_length(p_order_ids, 1) > 200 then
    raise exception 'too_many_orders: %', array_length(p_order_ids, 1)
      using errcode = '22023';
  end if;

  -- Ordered, so two riders touching overlapping sets take row locks in the
  -- same sequence and deadlock instead of interleaving.
  foreach v_id in array (select array_agg(x order by x) from unnest(p_order_ids) x)
  loop
    -- NAMED ARGUMENTS, because advance_order's third parameter is p_lat, not a
    -- note -- passing positionally here silently fed the reason into a
    -- latitude. Only the parameters a bulk transition can honestly supply are
    -- passed: proof, receiver and coordinates are per-parcel evidence and have
    -- no meaning for an armful, so a bulk 'delivered' will be refused by
    -- advance_order's own guards. That is correct and not worked around.
    --
    -- No exception handling on purpose. advance_order raises for a reason --
    -- wrong status, wrong rider, missing proof -- and swallowing one would
    -- report success for an armful that is short. The whole statement rolls
    -- back and the rider is told which parcel refused.
    perform public.advance_order(
      p_order_id => v_id,
      p_to       => p_to,
      p_reason   => p_reason
    );
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

comment on function public.advance_orders is
  'Advance several orders to the same status in one transaction, by looping '
  'advance_order so the state machine has exactly one implementation. Used by '
  'the rider''s collection card: ten parcels off one counter, one tap.';

grant execute on function public.advance_orders(uuid[], public.order_status, text)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 2. close_trip also lets go of finished collections
--
--  THE LEAK. A `pickup` leg is a parcel collected FROM a shop and carried to
--  the hub, so it is COMPLETE at `picked_up` -- close_trip's open-orders gate
--  says exactly that, counting only 'delivery' and 'return' legs.
--
--  But its detach block only releases rows with status = 'failed', and
--  unload_trip only touches 'pending' and 'assigned'. So a successfully
--  collected pickup keeps trip_id forever, and getRiderFeed -- which filters
--  `status in ('assigned','picked_up')` -- keeps showing it. It reappears as a
--  phantom stop on every later run that rider does, for good.
--
--  Nothing closes that loop today. This does: a pickup leg that reached the hub
--  is done, so it leaves the trip when the trip closes, exactly as a failure
--  does. `trip_leg` is cleared with it, which is what makes the row eligible
--  for load_trip again should the parcel ever need to move.
-- ----------------------------------------------------------------------------

create or replace function public.close_trip(p_trip_id uuid)
returns public.trips
language plpgsql security definer
set search_path = public
as $$
declare
  v_t        public.trips;
  v_r        public.routes;
  v_parcels  integer;
  v_pickups  integer;
  v_open     integer;
  v_released integer;
  v_held     integer;
  v_max      smallint;
  v_q        jsonb;
  v_total    bigint;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_t from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;
  if v_t.status = 'closed' then
    raise exception 'trip_already_closed' using errcode = '55000',
      hint = 'Correct a closed trip with an adjustment ledger entry.';
  end if;
  if v_t.status not in ('departed','returned') then
    raise exception 'trip_not_closable: %', v_t.status using errcode = '55000';
  end if;
  if v_t.rider_id is null then
    raise exception 'trip_has_no_rider' using errcode = '55000';
  end if;

  select * into v_r from public.routes where id = v_t.route_id;
  select s.max_delivery_attempts into v_max from public.app_settings s where s.id;

  select count(*) into v_open
    from public.orders o
   where o.trip_id = p_trip_id
     and o.trip_leg in ('delivery','return')
     and o.status in ('pending','assigned','picked_up');
  if v_open > 0 then
    raise exception 'trip_has_open_orders: %', v_open using errcode = '55000',
      hint = 'Every parcel must be delivered, returned, failed or cancelled before close.';
  end if;

  -- A return that reached the shop, and a delivery that reached the customer or
  -- died trying, are the same amount of riding.
  select
      count(*) filter (where o.trip_leg = 'delivery' and o.status in ('delivered','failed'))
    + count(*) filter (where o.trip_leg = 'return'   and o.status in ('returned','failed')),
      count(*) filter (where o.trip_leg = 'pickup'   and o.status in ('picked_up','delivered'))
    into v_parcels, v_pickups
    from public.orders o
   where o.trip_id = p_trip_id;

  v_q     := public.quote_trip_pay(v_parcels, v_pickups, v_t.route_id);
  v_total := (v_q ->> 'total')::bigint;

  update public.trips set
      status            = 'closed',
      closed_at         = now(),
      returned_at       = coalesce(returned_at, now()),
      parcel_count      = v_parcels,
      pickup_count      = v_pickups,
      base_pay          = (v_q ->> 'base_pay')::bigint,
      parcel_pay        = (v_q ->> 'parcel_pay')::bigint,
      pickup_pay        = (v_q ->> 'pickup_pay')::bigint,
      total_pay         = v_total,
      pay_tier_snapshot = v_q
   where id = p_trip_id
  returning * into v_t;

  select
      count(*) filter (where o.resolution is null
                         and not public.order_attempts_exhausted(o.id)),
      count(*) filter (where o.resolution is null
                         and public.order_attempts_exhausted(o.id))
    into v_released, v_held
    from public.orders o
   where o.trip_id = p_trip_id and o.status = 'failed';

  -- A failed RETURN leg keeps resolution = 'return', so the first branch holds
  -- it: it detaches and drops back into the returns pool for another attempt
  -- rather than being re-offered for delivery.
  update public.orders o
     set trip_id  = null,
         trip_leg = null,
         status   = case
                      when o.resolution is not null then o.status
                      when not public.order_attempts_exhausted(o.id)
                        then 'pending'::public.order_status
                      else o.status
                    end
   where o.trip_id = p_trip_id
     and o.status = 'failed';

  /*
    AND A COLLECTION THAT REACHED THE HUB IS DONE. (0025)

    A `pickup` leg is complete at `picked_up` -- the open-orders gate above
    counts only 'delivery' and 'return' for exactly that reason. But the detach
    above releases only failures, and unload_trip only touches 'pending' and
    'assigned', so a successfully collected pickup kept trip_id forever.

    getRiderFeed filters `status in ('assigned','picked_up')`, so that row came
    back as a phantom stop on every later run the rider did, for good. Nothing
    else closed the loop.
  */
  update public.orders o
     set trip_id  = null,
         trip_leg = null
   where o.trip_id = p_trip_id
     and o.trip_leg = 'pickup'
     and o.status in ('picked_up', 'delivered');

  if v_total > 0 then
    insert into public.cod_ledger (order_id, trip_id, rider_id, kind, amount, created_by, memo)
    values (null, p_trip_id, v_t.rider_id, 'trip_pay', -v_total,
            coalesce(auth.uid(), v_t.rider_id),
            v_r.code || ' ' || to_char(v_t.service_date, 'YYYY-MM-DD')
              || ' · ' || v_parcels || 'p/' || v_pickups || 'u')
    on conflict do nothing;
  end if;

  perform public.write_audit('trip.close', 'trips', v_t.id::text, null,
    to_jsonb(v_t) || jsonb_build_object(
      'released_for_retry',   coalesce(v_released, 0),
      'held_for_shop',        coalesce(v_held, 0)));
  return v_t;
end $$;

