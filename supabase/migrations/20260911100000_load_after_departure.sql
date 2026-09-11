-- ============================================================================
--  MINGALAR EXPRESS  ·  0039 — A RUN ON THE ROAD STILL TAKES PARCELS,
--                             AND A SHORT RUN STOPS DEMANDING AN EXCUSE
--
--  Two gates open. Both were refusing the office something it is entitled to
--  do, and both refusals were invisible until the moment they fired.
--
--  ---------------------------------------------------------------------------
--  1. `load_trip` ACCEPTS A DEPARTED RUN
--
--  A rider leaves the hub at 09:15. A shop books a parcel at 10:40 for a ward
--  that rider is about to pass through. The office could not give it to them:
--  `load_trip` took only `planned` and `loading`, and `trips_rider_open_uk`
--  forbids a second run. The parcel waited for tomorrow while the person who
--  could have carried it rode past the door.
--
--  THE ASYMMETRY THIS FIXES. `unload_trip` has always accepted a departed run
--  -- it refuses only `closed` and `cancelled`. So parcels could come OFF a run
--  in flight but never ON. There was no principle behind that, only the order
--  the two functions happened to be written in.
--
--  Nothing else in load_trip needs changing, which is the argument that this is
--  safe rather than merely small:
--
--    * the ceilings are computed over the trip AFTER this load (`where o.trip_id
--      = p_trip_id or o.id = any(v_ids)`), not over the batch, so a departed run
--      at 59/60 still refuses a second parcel. Loading late is not a way around
--      a cap.
--    * `orders_rider_matches_trip` is per-order and takes the run's rider from
--      `v_t.rider_id`, so a late parcel names the rider who is carrying it.
--    * the status write already reads `when v_t.rider_id is not null then
--      'assigned'`, so a late parcel lands ready rather than stuck at `pending`
--      behind a `depart_trip` that has already run.
--    * `update trips set status = 'loading' ... and status = 'planned'` does not
--      match a departed row, so the run stays departed. It does not reverse.
--    * `collect_before_deliver` still applies: a brand-new parcel joins as a
--      `pickup` leg, which is right -- the rider goes to the shop for it.
--
--  AND THE RIDER ALREADY FINDS OUT. This writes `orders`, the rider dashboard
--  subscribes to `orders` UPDATE, and NewWorkAlert chimes on the count rising.
--  That path has been built and unreachable.
--
--  STILL ONE RUN PER RIDER. `trips_rider_open_uk` is untouched. Two open runs
--  would break `getRiderFeed`, which takes `limit(1)` on the trip but does not
--  scope its orders query to it -- the rider would see both manifests merged
--  under one run's hub and route. Topping up the run they are on is the whole
--  requirement anyway.
--
--  ---------------------------------------------------------------------------
--  2. A SHORT RUN DEPARTS WITHOUT A TYPED REASON
--
--  `min_parcels_per_trip` is a margin guard: pay is per RUN (a base plus a
--  per-parcel rate), so a run of two parcels costs more than it earns. The
--  guard is real. Making somebody type ten characters at it was not.
--
--  In practice the operator is the owner. Demanding a written justification
--  addressed to themselves, on every run below the floor, is how an override
--  stops being read -- 0028 already made that argument about collections and it
--  applies here with more force at this volume.
--
--  WHAT IS KEPT IS THE RECORD, WHICH IS THE PART THAT MATTERED. The
--  `trip.depart_below_minimum` audit row still fires on every short departure,
--  still carries the shortfall and the projected pay and fees at the moment of
--  the decision, and `depart_override_reason` still stores a reason when one is
--  given. The office loses the typing, not the trail.
--
--  A reason that IS supplied must still be a reason: the 10-character floor
--  survives for a non-null value, so `p_override_reason => 'ok'` is still
--  refused rather than silently accepted as an audit entry saying nothing.
--
--  Forward-only. Both changes widen what is accepted; nothing that was legal
--  before becomes illegal.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. load_trip — `departed` joins the loadable statuses
--
--  0028's body, one line changed. Reproduced whole because `create or replace`
--  cannot patch a statement.
-- ----------------------------------------------------------------------------

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
  v_wrongside integer;
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
  /*
    0039: `departed` ADDED. A rider on the road can be given more work -- see
    the header. `returned`, `closed` and `cancelled` still refuse: the first
    means the bike is back at the hub, and the last two are terminal, with
    `closed` having already booked the pay this parcel would have counted
    toward.
  */
  if v_t.status not in ('planned','loading','departed') then
    raise exception 'trip_not_loadable: %', v_t.status using errcode = '55000';
  end if;

  select * into v_r from public.routes where id = v_t.route_id;

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

  /*
    0028 — COLLECT FIRST, THEN DELIVER.

    A parcel is on exactly one side of the hub, and picked_up_at says which:
    null means it is still on the shop's shelf, set means we are holding it.
    A delivery run may only carry what we hold; a collection run may only fetch
    what we do not. Returns are exempt -- they travel to a shop, not from one.
  */
  if p_leg = 'delivery' then
    select count(*) into v_wrongside
      from public.orders o
     where o.id = any(v_ids) and o.picked_up_at is null;
    if v_wrongside > 0 then
      raise exception 'not_collected_yet: % parcel(s)', v_wrongside
        using errcode = '55000',
              hint = 'These are still at their shop. Put them on a collection run first.';
    end if;
  elsif p_leg = 'pickup' then
    select count(*) into v_wrongside
      from public.orders o
     where o.id = any(v_ids) and o.picked_up_at is not null;
    if v_wrongside > 0 then
      raise exception 'already_collected: % parcel(s)', v_wrongside
        using errcode = '55000',
              hint = 'These are already at the hub. Put them on a delivery run.';
    end if;
  end if;

  -- A held parcel keeps `picked_up`, so orders_assigned_needs_rider requires it
  -- to keep a rider -- and the assignment below takes the RUN's rider, which is
  -- null until one is picked.
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

  /*
    Ceilings are checked against the trip AFTER this load, not just this batch --
    which is exactly why 0039 can open the departed gate without opening a hole.
    A run already at its parcel or cash ceiling refuses a late addition on the
    same arithmetic that refuses an early one.
  */
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
         rider_id    = v_t.rider_id,
         status      = case
                         when o.status = 'picked_up' then o.status
                         when v_t.rider_id is not null then 'assigned'::public.order_status
                         else o.status
                       end,
         assigned_at = case when v_t.rider_id is not null then coalesce(o.assigned_at, now()) end,
         assigned_by = case when v_t.rider_id is not null then auth.uid() end,
         cod_status  = case
                         when p_leg = 'return' then 'none'::public.cod_status
                         when v_t.rider_id is not null and o.payment_method = 'cod'
                           then 'pending'::public.cod_status
                         else o.cod_status
                       end,
         fail_reason = null
   where o.id = any(v_ids);

  /*
    Only a PLANNED run advances to `loading`. A departed one is untouched by
    this and stays departed -- topping up a run must never reverse it, or the
    rider's feed would lose the trip and `depart_trip` could run twice.
  */
  update public.trips set status = 'loading'
   where id = p_trip_id and status = 'planned'
  returning * into v_t;
  if v_t.id is null then
    select * into v_t from public.trips where id = p_trip_id;
  end if;

  perform public.write_audit('trip.load', 'trips', p_trip_id::text, null,
    jsonb_build_object('leg', p_leg, 'order_ids', to_jsonb(v_ids),
                       'parcels_after', v_parcels, 'cod_after', v_cod,
                       'held_at_hub', v_held,
                       -- Worth being able to find later: a load onto a moving
                       -- bike is a different operational event from one at the
                       -- hub, even though the row it writes is identical.
                       'after_departure', v_t.status = 'departed'));
  return v_t;
end $$;

comment on function public.load_trip is
  'Attach parcels to a run on a given leg. 0028: a delivery leg may carry only '
  'parcels already collected (picked_up_at set) and a pickup leg only parcels '
  'still at their shop. 0039: a DEPARTED run still accepts parcels -- a rider '
  'on the road can be given more work, and the ceilings are computed over the '
  'trip after the load, so loading late is not a way around a cap.';

-- ----------------------------------------------------------------------------
-- 2. depart_trip — the override reason becomes optional
--
--  0028's body, one guard removed and one narrowed. The audit row is unchanged.
-- ----------------------------------------------------------------------------

create or replace function public.depart_trip(
  p_trip_id         uuid,
  p_override_reason text default null
) returns public.trips
language plpgsql security definer
set search_path = public
as $$
declare
  v_t       public.trips;
  v_r       public.routes;
  v_min     smallint;
  v_parcels integer;
  v_pickups integer;
  v_stuck   integer;
  v_reason  text := nullif(trim(coalesce(p_override_reason, '')), '');
  v_short   boolean;
  v_quote   jsonb;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_t from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;
  if v_t.status not in ('planned','loading') then
    raise exception 'trip_not_departable: %', v_t.status using errcode = '55000';
  end if;
  if v_t.rider_id is null then
    raise exception 'trip_has_no_rider' using errcode = '55000',
      hint = 'Call assign_trip_rider() before departure.';
  end if;

  select * into v_r from public.routes where id = v_t.route_id;
  select s.min_parcels_per_trip into v_min from public.app_settings s where s.id;

  select
      -- Return legs count as parcels here for the same reason they do in
      -- close_trip: the rider carries them, they occupy the bike, and a run of
      -- nothing but returns is a real run.
      count(*) filter (where o.trip_leg in ('delivery','return')),
      count(*) filter (where o.trip_leg = 'pickup')
    into v_parcels, v_pickups
    from public.orders o
   where o.trip_id = p_trip_id and o.status <> 'cancelled';

  if v_parcels = 0 and v_pickups = 0 then
    raise exception 'trip_empty' using errcode = '55000';
  end if;

  v_short := (v_parcels + v_pickups) < coalesce(v_min, 0);

  /*
    0039: A SHORT RUN NO LONGER NEEDS A TYPED REASON.

    `trip_below_minimum` used to be raised here whenever v_reason was null,
    forcing the caller back with a modal. The minimum is a margin guard -- pay
    is per run, so a short one costs more than it earns -- and that guard is
    still worth SEEING. It is not worth a written justification addressed to the
    person who already decided.

    What survives is the record: the `trip.depart_below_minimum` audit row below
    still fires on every short departure with the shortfall and the money, and
    `depart_override_reason` still stores a reason when one is given. The floor
    on that reason survives too, for a non-null value only -- a supplied reason
    must still say something, or the audit trail fills with 'ok'.
  */
  if v_reason is not null and length(v_reason) < 10 then
    raise exception 'override_reason_too_short'
      using errcode = '22023',
            hint = 'Say why this run is going out short, in at least 10 characters.';
  end if;

  -- Nothing may still be sitting at 'pending': that means it was attached before
  -- a rider existed and never picked up the assignment.
  update public.orders
     set rider_id    = v_t.rider_id,
         status      = 'assigned',
         assigned_at = coalesce(assigned_at, now()),
         assigned_by = auth.uid(),
         cod_status  = case when payment_method = 'cod' then 'pending'::public.cod_status
                            else cod_status end
   where trip_id = p_trip_id and status in ('pending','failed','assigned');

  /*
    0028: `picked_up` joins the ready set. A delivery run now carries parcels
    collected on an earlier run -- they keep `picked_up` (there is no
    picked_up -> assigned edge) and the promotion above deliberately skips them.
  */
  select count(*) into v_stuck
    from public.orders o
   where o.trip_id = p_trip_id and o.status not in ('assigned','picked_up','cancelled');
  if v_stuck > 0 then
    raise exception 'trip_orders_not_ready: %', v_stuck using errcode = '55000';
  end if;

  update public.trips set
      status                 = 'departed',
      departed_at            = now(),
      departed_by            = auth.uid(),
      depart_parcel_count    = v_parcels,
      -- Still only recorded when it actually is an override. A NULL now means
      -- "met the rule, OR went short without comment" -- the audit row below is
      -- what distinguishes those, and it always fires.
      depart_override_reason = case when v_short then v_reason end
   where id = p_trip_id
  returning * into v_t;

  if v_short then
    v_quote := public.quote_trip_pay(v_parcels, v_pickups, v_t.route_id);
    perform public.write_audit(
      'trip.depart_below_minimum', 'trips', v_t.id::text,
      jsonb_build_object('minimum', v_min),
      jsonb_build_object(
        'route',           v_r.code,
        'service_date',    v_t.service_date,
        'rider_id',        v_t.rider_id,
        'parcels',         v_parcels,
        'pickups',         v_pickups,
        'shortfall',       v_min - (v_parcels + v_pickups),
        'reason',          v_reason,
        -- The money the override costs, recorded at the moment of the decision
        -- rather than reconstructed later from tiers that may have moved.
        'projected_pay',   (v_quote ->> 'total')::bigint,
        'projected_fees',  v_parcels::bigint * v_r.per_parcel_fee,
        'projected_margin',
          v_parcels::bigint * v_r.per_parcel_fee - (v_quote ->> 'total')::bigint
      ));
  else
    perform public.write_audit('trip.depart', 'trips', v_t.id::text, null,
      jsonb_build_object('parcels', v_parcels, 'pickups', v_pickups));
  end if;

  return v_t;
end $$;

comment on function public.depart_trip is
  'Send a run out. 0028: collections count toward min_parcels_per_trip. 0039: a '
  'short run no longer needs a typed override reason -- the margin guard is '
  'worth seeing, not worth a justification addressed to the person who already '
  'decided. The trip.depart_below_minimum audit row still fires on every short '
  'departure with the shortfall and the money; a reason is optional but must '
  'still say something when given.';
