-- ============================================================================
--  MINGALAR EXPRESS  ·  0028 — COLLECT FIRST, THEN DELIVER
--
--  THE OPERATING MODEL CHANGES HERE, so read this before the code.
--
--  Until now a run was point-to-point: `load_trip(..., 'delivery')` took a
--  parcel straight from the shop's counter to the customer's door on one run,
--  and the rider's "I have the parcel" tap WAS the collection. The hub was
--  where a route started and ended, not somewhere parcels passed through.
--
--  From here it is hub-and-spoke, and it is mandatory:
--
--      run 1   shop  -> hub      leg 'pickup'
--      run 2   hub   -> customer leg 'delivery'
--
--  A parcel that has never been collected CANNOT be put on a delivery run. Not
--  by the board, not by a dispatcher, not by anything that can reach the RPC --
--  the rule lives here rather than in the UI so there is nothing to work
--  around.
--
--  ---------------------------------------------------------------------------
--  WHAT IT COSTS, stated plainly because it is real money
--
--  Trip pay is route_pickup_rate (500) + route_parcel_rate (300). A parcel used
--  to cost 300 in rider pay and now costs 800. Collections batch -- one rider
--  clears thirty parcels from five shops in a run -- so the cost per RUN is not
--  2.7x even though the cost per parcel is. Accepted deliberately; the rates
--  are editable in Super Admin -> Pricing.
--
--  ---------------------------------------------------------------------------
--  HOW "HAS IT BEEN COLLECTED?" IS ANSWERED
--
--  By `orders.picked_up_at`, which stops being wiped. The `pending` branch of
--  the status machine cleared it as part of "unassign: wipe the assignment" --
--  but a collection is not assignment data, it is a physical fact about where
--  the parcel is, and taking a rider off a job does not put the parcel back on
--  the shop's shelf. That wipe was always wrong; under this rule it is
--  catastrophic, because it would send a rider to collect a parcel that is
--  sitting at our own hub.
--
--  That single change is also what makes a failed delivery work with no other
--  edits: close_trip still sends a non-exhausted failure back to `pending`, but
--  because picked_up_at survives, it lands in the HUB pool for another delivery
--  attempt rather than in the shop pool for a pointless second collection.
--
--  A failed COLLECTION is the mirror case and stays correct for free: the rider
--  reached the shop and came away empty, so there is no picked_up event, no
--  picked_up_at, and the parcel is still the shop's to hand over.
--
--  ---------------------------------------------------------------------------
--  THE MINIMUM-VOLUME GATE HAD TO MOVE TOO
--
--  depart_trip measured a run by `trip_leg in ('delivery','return')` only, so
--  thirty collections read as "0/20 parcels" and demanded a typed override.
--  Under this model half of all runs are collections; half of all departures
--  would have needed one. A bike with thirty parcels on it is a full run
--  whichever way they are pointing.
--
--  Forward-only.
-- ============================================================================

set check_function_bodies = off;

-- ----------------------------------------------------------------------------
-- 1. picked_up_at becomes permanent
-- ----------------------------------------------------------------------------

create or replace function public.tg_orders_status_machine()
returns trigger language plpgsql set search_path = public as $$
declare v_ok boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  v_ok := case old.status
            when 'pending'   then new.status in ('assigned','cancelled','returned')
            when 'assigned'  then new.status in ('picked_up','failed','pending','cancelled','returned')
            when 'picked_up' then new.status in ('delivered','failed','returned')
            when 'failed'    then new.status in ('assigned','pending','cancelled','returned')
            else false            -- delivered / cancelled / returned are terminal
          end;

  if not v_ok then
    raise exception 'illegal_transition: % -> %', old.status, new.status
      using errcode = '55000';
  end if;

  -- A return is something the SHOP asked for. Reaching this status any other way
  -- would let an awkward parcel be closed off as one.
  if new.status = 'returned' and coalesce(new.resolution, '') <> 'return' then
    raise exception 'return_not_requested'
      using errcode = '55000',
            hint = 'Only a parcel the shop asked back (resolution = return) can be returned.';
  end if;

  case new.status
    when 'picked_up' then
      new.picked_up_at := coalesce(new.picked_up_at, now());

    when 'delivered' then
      new.delivered_at := coalesce(new.delivered_at, now());
      new.closed_at    := now();
      new.cod_status   := case when new.payment_method = 'cod' then 'collected'::public.cod_status
                               else 'none'::public.cod_status end;

    when 'pending' then                      -- unassign: wipe the assignment
      new.rider_id                := null;
      new.assigned_at             := null;
      new.assigned_by             := null;
      new.assign_distance_km      := null;
      new.rider_commission_pct    := null;
      new.rider_commission_amount := null;
      new.platform_fee_amount     := null;
      -- 0028: picked_up_at is NOT cleared any more. It is not assignment data.
      -- It records that the parcel physically left the shop, and unassigning a
      -- rider does not carry it back there. Clearing it would put a parcel that
      -- is on our own hub shelf into the "go and collect this" pool.
      new.closed_at               := null;
      new.cod_status              := 'none';

    when 'returned' then
      new.closed_at  := now();
      -- Nothing was collected and nothing is owed. Leaving cod_status at
      -- 'pending' would leave the parcel looking like uncollected cash forever.
      new.cod_status := 'none';

    when 'cancelled', 'failed' then
      new.closed_at := now();

    else null;
  end case;

  return new;
end $$;

-- ----------------------------------------------------------------------------
-- 2. BACKFILL — restore what the old wipe destroyed
--
--  order_status_events is append-only and was never touched by it, so the first
--  `-> picked_up` checkpoint is an exact record of when each parcel actually
--  left its shop. Same source order_attempt_count already derives from.
-- ----------------------------------------------------------------------------

update public.orders o
   set picked_up_at = e.first_pickup
  from (
    select order_id, min(created_at) as first_pickup
      from public.order_status_events
     where to_status = 'picked_up'
     group by order_id
  ) e
 where e.order_id = o.id
   and o.picked_up_at is null;

create index if not exists orders_hub_pool_idx
  on public.orders (picked_up_at)
  where trip_id is null and picked_up_at is not null;

-- ----------------------------------------------------------------------------
-- 3. THE RULE
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
  if v_t.status not in ('planned','loading') then
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
  'Attach parcels to a run on a given leg. 0028: a delivery leg may carry only '
  'parcels already collected (picked_up_at set) and a pickup leg only parcels '
  'still at their shop. Collect first, then deliver -- enforced here so there '
  'is nothing for a UI to work around.';

-- ----------------------------------------------------------------------------
-- 4. A run of collections is a run
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
      -- nothing but returns is a real run. Counting only 'delivery' made such a
      -- run fail departure as `trip_empty`.
      count(*) filter (where o.trip_leg in ('delivery','return')),
      count(*) filter (where o.trip_leg = 'pickup')
    into v_parcels, v_pickups
    from public.orders o
   where o.trip_id = p_trip_id and o.status <> 'cancelled';

  if v_parcels = 0 and v_pickups = 0 then
    raise exception 'trip_empty' using errcode = '55000';
  end if;

  /*
    0028: collections count toward the minimum. The gate measured
    trip_leg in ('delivery','return') only, so a run of thirty collections read
    as "0/20 parcels" and demanded a typed override reason. Now that every
    parcel is collected before it is delivered, half of all runs are
    collections -- half of all departures would have needed an override, which
    is how an override stops meaning anything. A bike with thirty parcels on it
    is a full run whichever way they are pointing.
  */
  v_short := (v_parcels + v_pickups) < coalesce(v_min, 0);

  if v_short and v_reason is null then
    raise exception 'trip_below_minimum: %/% parcels', v_parcels + v_pickups, v_min
      using errcode = '55000',
            hint = 'Pass override_reason (10 characters or more) to dispatch this run anyway.';
  end if;
  if v_short and length(v_reason) < 10 then
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
   -- WIDENED IN 0015. A parcel loaded while a rider was already on the run is
   -- `assigned`, and was skipped here — so a rider swap survived departure and
   -- the run left with its parcels naming the previous rider.
   where trip_id = p_trip_id and status in ('pending','failed','assigned');

  /*
    0028: `picked_up` joins the ready set. A delivery run now carries parcels
    collected on an earlier run -- they keep `picked_up` (there is no
    picked_up -> assigned edge) and the promotion above deliberately skips
    them. Without this they counted as stuck and no delivery run could ever
    leave the hub.
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
      -- Only recorded when it actually is an override, so a NULL here always
      -- means "this run met the rule".
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
