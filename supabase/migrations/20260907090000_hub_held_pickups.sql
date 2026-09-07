-- ============================================================================
--  MINGALAR EXPRESS  ·  0027 — A COLLECTED PARCEL CAN BE DELIVERED
--
--  THE BUG. A pickup leg means "collect this FROM the shop and bring it to the
--  hub". 0025 taught close_trip to let go of one when the run ends:
--
--      update public.orders set trip_id = null, trip_leg = null
--       where trip_id = p_trip_id and trip_leg = 'pickup'
--         and status in ('picked_up','delivered');
--
--  which is right as far as it goes -- without it the parcel haunted the
--  rider's feed forever. But it leaves `status = 'picked_up'`, and every pool
--  the dispatcher board reads wants something else:
--
--      unrouted   trip_id is null and status = 'pending'
--      returns    resolution = 'return'
--      stalled    trip_id is null and status = 'failed'
--
--  So the parcel is sitting on a shelf at the hub, attached to no run, matching
--  no query, invisible on the planning board. And load_trip would refuse it
--  anyway: its eligibility test is `status in ('pending','failed')`.
--
--  A shop's parcel is collected, brought in, and then quietly lost. Nobody has
--  hit it yet only because no pickup run has been closed in production.
--
--  ---------------------------------------------------------------------------
--  WHY NOT JUST SEND IT BACK TO 'pending'
--
--  Because then it is indistinguishable from a parcel still sitting in the
--  shop, and the next dispatcher can load it onto another PICKUP run -- sending
--  a rider across Yangon to collect something already on our own shelf. The
--  status is what stops that, so the status stays.
--
--  It also cannot go to 'pending': tg_orders_status_machine allows
--  picked_up -> delivered | failed | returned and nothing else, and the
--  transition to 'pending' wipes the assignment block including picked_up_at.
--
--  So the parcel keeps `picked_up` -- which is the truth, we are holding it --
--  and load_trip learns to accept that state for a DELIVERY leg. The rider's
--  app already does the right thing with it: getRiderFeed takes
--  status in ('assigned','picked_up'), and job-actions offers the delivery flow
--  at 'picked_up'. Nothing downstream changes.
--
--  ---------------------------------------------------------------------------
--  THE CONSTRAINT THAT SHAPES THIS
--
--      orders_assigned_needs_rider
--        check (status = 'pending' or status = 'cancelled' or rider_id is not null)
--
--  A held parcel is 'picked_up', so it MUST keep a rider -- it cannot be
--  detached from one, which is why the phantom-stop half of this is fixed in
--  the feed query rather than here. And loading one onto a run with no rider
--  yet would null its rider_id (0015: the run owns the rider, deliberately not
--  coalesce) and break the check. That is refused below with something an
--  operator can act on, rather than a 23514.
--
--  Forward-only. Only load_trip changes.
-- ============================================================================

set check_function_bodies = off;

create or replace function public.load_trip(
  p_trip_id   uuid,
  p_order_ids uuid[],
  p_leg       text default 'delivery'
) returns public.trips
language plpgsql security definer
set search_path = public
as $$
declare
  v_t         public.trips;
  v_r         public.routes;
  v_ids       uuid[] := coalesce(p_order_ids, '{}'::uuid[]);
  v_eligible  integer;
  v_mismatch  integer;
  v_held      integer;
  v_parcels   integer;
  v_cod       bigint;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_leg not in ('delivery','pickup','return') then
    raise exception 'bad_leg: %', p_leg using errcode = '22023';
  end if;
  if array_length(v_ids, 1) is null then
    raise exception 'no_orders' using errcode = '22023';
  end if;

  select * into v_t from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;
  if v_t.status not in ('planned','loading') then
    raise exception 'trip_not_loadable: %', v_t.status using errcode = '55000';
  end if;

  select * into v_r from public.routes where id = v_t.route_id;

  -- 0027: a parcel already collected onto our own shelf is loadable again, but
  -- only outbound. Offering it to a 'pickup' leg would send a rider to fetch
  -- what we are already holding.
  select count(*) into v_eligible
    from public.orders o
   where o.id = any(v_ids)
     and o.trip_id is null
     and (o.status in ('pending','failed')
          or (o.status = 'picked_up' and p_leg = 'delivery'));

  if v_eligible <> array_length(v_ids, 1) then
    raise exception 'orders_not_loadable: % of % eligible', v_eligible, array_length(v_ids, 1)
      using errcode = '55000',
            hint = 'An order is already on a trip, in flight, or terminal.';
  end if;

  -- A held parcel keeps `picked_up`, so orders_assigned_needs_rider requires it
  -- to keep a rider -- and the assignment below takes the RUN's rider, which is
  -- null until one is picked. Refuse now, with the fix named.
  select count(*) into v_held
    from public.orders o
   where o.id = any(v_ids) and o.status = 'picked_up';
  if v_held > 0 and v_t.rider_id is null then
    raise exception 'trip_needs_rider_for_held_parcels: % parcel(s)', v_held
      using errcode = '55000',
            hint = 'Assign a rider to this run before loading parcels already at the hub.';
  end if;

  -- The leg must match the parcel's intent, in both directions.
  select count(*) into v_mismatch
    from public.orders o
   where o.id = any(v_ids)
     and ((p_leg = 'return' and coalesce(o.resolution, '') <> 'return')
       or (p_leg <> 'return' and o.resolution = 'return'));
  if v_mismatch > 0 then
    raise exception 'leg_resolution_mismatch: % parcel(s)', v_mismatch
      using errcode = '55000',
            hint = 'Parcels the shop asked back load onto a return leg, and only those.';
  end if;

  -- Ceilings are checked against the trip AFTER this load, not just this batch.
  -- Return legs are excluded from the CASH ceiling: their cod_amount describes
  -- money nobody will collect, and counting it would block deliveries that would
  -- have collected real cash.
  select
      count(*) filter (where coalesce(o.trip_leg, p_leg) = 'delivery'),
      coalesce(sum(o.cod_amount) filter (
        where coalesce(o.trip_leg, p_leg) <> 'return' and o.resolution is distinct from 'return'
      ), 0)
    into v_parcels, v_cod
    from public.orders o
   where o.trip_id = p_trip_id or o.id = any(v_ids);

  if p_leg = 'delivery' and v_parcels > v_r.max_parcels_per_trip then
    raise exception 'trip_over_parcel_cap: % > %', v_parcels, v_r.max_parcels_per_trip
      using errcode = '55000';
  end if;
  if v_cod > v_r.max_cod_per_trip then
    raise exception 'trip_over_cod_cap: % > %', v_cod, v_r.max_cod_per_trip
      using errcode = '55000',
            hint = 'Split the load across two runs or raise routes.max_cod_per_trip.';
  end if;

  update public.orders o
     set trip_id     = p_trip_id,
         trip_leg    = p_leg,
         -- 0015: the RUN owns the rider, so NOT coalesce. A parcel held at the
         -- attempt cap keeps its old rider_id, and loading it onto a run that
         -- has no rider yet used to carry that stale name along.
         rider_id    = v_t.rider_id,
         -- 0027: a parcel we are already holding stays 'picked_up'. Moving it
         -- to 'assigned' is not merely wrong, it is refused --
         -- tg_orders_status_machine has no picked_up -> assigned edge.
         status      = case
                         when o.status = 'picked_up' then o.status
                         when v_t.rider_id is not null then 'assigned'::public.order_status
                         else o.status
                       end,
         assigned_at = case when v_t.rider_id is not null then coalesce(o.assigned_at, now()) end,
         assigned_by = case when v_t.rider_id is not null then auth.uid() end,
         -- Nothing is collected on a return, so it must not look like pending cash.
         cod_status  = case
                         when p_leg = 'return' then 'none'::public.cod_status
                         when v_t.rider_id is not null and o.payment_method = 'cod'
                           then 'pending'::public.cod_status
                         else o.cod_status
                       end,
         fail_reason = null
   where o.id = any(v_ids);

  update public.trips set status = 'loading'
   where id = p_trip_id and status = 'planned'
  returning * into v_t;
  if v_t.id is null then
    select * into v_t from public.trips where id = p_trip_id;
  end if;

  perform public.write_audit('trip.load', 'trips', p_trip_id::text, null,
    jsonb_build_object('leg', p_leg, 'order_ids', to_jsonb(v_ids),
                       'parcels_after', v_parcels, 'cod_after', v_cod,
                       'held_at_hub', v_held));
  return v_t;
end $$;

comment on function public.load_trip is
  'Attach parcels to a run on a given leg. Accepts parcels already collected '
  'onto the hub shelf (status picked_up, no trip) for a DELIVERY leg only -- '
  'offering them to a pickup leg would send a rider to fetch what we hold.';
