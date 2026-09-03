-- ============================================================================
--  MINGALAR EXPRESS  ·  0015 — THE TRIP OWNS THE RIDER
--
--  Found live on staging: a run assigned to Zaw Zaw whose four parcels all still
--  belonged to Thiha. Zaw Zaw's dashboard was empty and nobody could see why.
--
--  WHAT HAPPENED. `assign_trip_rider` does re-stamp the parcels already on the
--  run — but only `where status in ('pending','failed')`. The dispatcher had
--  assigned Thiha first, so `load_trip` had already moved every parcel to
--  `assigned`, and the re-stamp matched nothing. `depart_trip` carries the same
--  filter, so the run would have LEFT in that state.
--
--  This is not a display bug. `orders_read_rider` is `rider_id = auth.uid()`, so:
--
--    Zaw Zaw   holds the run and sees no parcels — no addresses, no manifest,
--              and no way to mark anything delivered.
--    Thiha     is on no run at all and can still pick up, deliver and COLLECT
--              CASH for all four. The cod_collected lines land on his ledger.
--    close_trip pays trip_pay to trips.rider_id — Zaw Zaw — for a run he never
--              rode.
--
--  So the settlement is wrong for two riders at once, in opposite directions.
--
--  THE RULE, stated once: while a parcel is on a run, the RUN owns the rider.
--  `orders.rider_id` is a denormalised copy of `trips.rider_id` and there is no
--  case where the two should disagree. Three changes make that true and one
--  makes it stay true.
--
--  Forward-only. Includes a repair for rows already adrift.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. assign_trip_rider — re-stamp every parcel that has not physically moved
--
--  Before departure a parcel on a run can only be pending, failed, assigned or
--  cancelled: `trip_rider_locked` refuses a departed run, so picked_up is
--  unreachable here. `assigned` was the one state missing from the list, and it
--  is the state load_trip leaves everything in whenever a rider was already on
--  the run — which is the normal order of operations, not an edge case.
--
--  `cancelled` stays excluded: the shop pulled that parcel and it belongs to
--  nobody.
-- ----------------------------------------------------------------------------

create or replace function public.assign_trip_rider(
  p_trip_id  uuid,
  p_rider_id uuid
) returns public.trips
language plpgsql security definer
set search_path = public
as $$
declare
  v_t     public.trips;
  v_r     public.rider_profiles;
  v_prev  uuid;
  v_moved integer;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_t from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;
  if v_t.status not in ('planned','loading') then
    raise exception 'trip_rider_locked: %', v_t.status
      using errcode = '55000',
            hint = 'Change the rider before departure, or cancel and re-plan.';
  end if;
  v_prev := v_t.rider_id;

  select * into v_r from public.rider_profiles where id = p_rider_id for update;
  if not found then
    raise exception 'rider_not_found' using errcode = 'P0002';
  end if;

  -- trips_rider_open_uk already makes "two open runs, one rider" unrepresentable;
  -- this turns the resulting 23505 into a message a dispatcher can act on.
  if exists (select 1 from public.trips t
              where t.rider_id = p_rider_id and t.id <> p_trip_id
                and t.status in ('planned','loading','departed')) then
    raise exception 'rider_already_on_trip' using errcode = '55000';
  end if;

  update public.trips set rider_id = p_rider_id where id = p_trip_id
  returning * into v_t;

  update public.orders
     set rider_id    = p_rider_id,
         status      = 'assigned',
         assigned_at = coalesce(assigned_at, now()),
         assigned_by = auth.uid(),
         cod_status  = case when payment_method = 'cod' then 'pending'::public.cod_status
                            else 'none'::public.cod_status end
   where trip_id = p_trip_id
     and status in ('pending','failed','assigned');
  get diagnostics v_moved = row_count;

  -- The hand-over is recorded, not just the arrival. "Who had these parcels an
  -- hour ago" is the first question asked when cash goes missing.
  perform public.write_audit('trip.assign_rider', 'trips', v_t.id::text,
                             jsonb_build_object('rider_id', v_prev),
                             jsonb_build_object('rider_id', p_rider_id,
                                                'parcels_moved', v_moved));
  return v_t;
end $$;

comment on function public.assign_trip_rider is
  'Puts a rider on a run and moves every parcel already loaded onto it with '
  'them. Refused once the run has departed.';


-- ----------------------------------------------------------------------------
-- 2. depart_trip — the same filter, the same hole
--
--  Only the re-stamp differs from 0013. If the rider was swapped after loading,
--  this was the last chance to notice and it did not.
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

  v_short := v_parcels < coalesce(v_min, 0);

  if v_short and v_reason is null then
    raise exception 'trip_below_minimum: %/% parcels', v_parcels, v_min
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

  select count(*) into v_stuck
    from public.orders o
   where o.trip_id = p_trip_id and o.status not in ('assigned','cancelled');
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
        'shortfall',       v_min - v_parcels,
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


-- ----------------------------------------------------------------------------
-- 3. load_trip — the run's rider wins, even when it has none
--
--  0013 wrote `rider_id = coalesce(v_t.rider_id, o.rider_id)`, which keeps a
--  stale rider on a parcel loaded onto a run that has no rider yet. That can
--  happen for real: a parcel held at the attempt cap keeps `status = 'failed'`
--  AND its old rider_id when close_trip releases it.
--
--  There is no reading under which that is right, and it is the last way the
--  two columns could disagree.
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
     and o.status in ('pending','failed');

  if v_eligible <> array_length(v_ids, 1) then
    raise exception 'orders_not_loadable: % of % eligible', v_eligible, array_length(v_ids, 1)
      using errcode = '55000',
            hint = 'An order is already on a trip, in flight, or terminal.';
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
         status      = case when v_t.rider_id is not null then 'assigned'::public.order_status
                            else o.status end,
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
                       'parcels_after', v_parcels, 'cod_after', v_cod));
  return v_t;
end $$;


-- ----------------------------------------------------------------------------
-- 4. Repair what is already adrift
--
--  Runs BEFORE the constraint in §5, which would otherwise refuse to be created
--  against a database that already violates it.
--
--  Only rider_id is corrected. Status is left alone: a mismatched parcel is
--  `assigned` either way, and rewriting statuses in a migration would fire the
--  state machine over rows nobody has looked at.
-- ----------------------------------------------------------------------------

do $$
declare v_n integer;
begin
  update public.orders o
     set rider_id = t.rider_id
    from public.trips t
   where t.id = o.trip_id
     and o.rider_id is distinct from t.rider_id
     and o.status <> 'cancelled';
  get diagnostics v_n = row_count;

  if v_n > 0 then
    perform public.write_audit('trip.rider_drift_repair', 'orders', null, null,
      jsonb_build_object('orders_repaired', v_n, 'migration', '0015'));
    raise notice '0015: repaired % parcel(s) naming the wrong rider', v_n;
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 5. Make it unrepresentable
--
--  A DEFERRED constraint trigger, not an immediate one: assign_trip_rider
--  updates `trips` and then `orders`, so the two rows legitimately disagree for
--  the width of a statement. Checking at COMMIT means the RPCs are free to work
--  in whatever order suits them and the invariant still cannot survive the
--  transaction.
--
--  This is the guard the codebase was missing. Two places had to agree about
--  which rider holds a parcel, and for a fortnight they quietly did not.
-- ----------------------------------------------------------------------------

create or replace function public.tg_order_rider_matches_trip()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_code       text;
  v_trip_id    uuid;
  v_status     public.order_status;
  v_rider      uuid;
  v_trip_rider uuid;
begin
  -- IT MUST RE-READ THE ROW. A deferred trigger fires at COMMIT with the NEW
  -- image captured when the event was QUEUED, not the row's final state. So a
  -- transaction that moves a run from rider A to rider B and back again queues
  -- an event holding "rider B" and would fail against a run that now, correctly,
  -- says rider A. Trusting NEW here made assign_trip_rider unusable twice in one
  -- transaction — which is exactly what a dispatcher correcting a mistake does.
  select o.code, o.trip_id, o.status, o.rider_id
    into v_code, v_trip_id, v_status, v_rider
    from public.orders o
   where o.id = new.id;

  -- Deleted later in the same transaction.
  if not found then
    return null;
  end if;

  -- A parcel not on a run answers to nobody; a cancelled one to nobody either.
  if v_trip_id is null or v_status = 'cancelled' then
    return null;
  end if;

  select t.rider_id into v_trip_rider from public.trips t where t.id = v_trip_id;
  if not found then
    return null;
  end if;

  if v_rider is distinct from v_trip_rider then
    raise exception
      'order_rider_differs_from_trip: order % names %, run % names %',
      v_code, coalesce(v_rider::text, 'nobody'),
      v_trip_id, coalesce(v_trip_rider::text, 'nobody')
      using errcode = '23514',
            hint = 'While a parcel is on a run, the run owns the rider.';
  end if;
  return null;
end $$;

drop trigger if exists orders_rider_matches_trip on public.orders;
create constraint trigger orders_rider_matches_trip
  after insert or update of rider_id, trip_id, status on public.orders
  deferrable initially deferred
  for each row execute function public.tg_order_rider_matches_trip();

comment on function public.tg_order_rider_matches_trip is
  'Deferred to commit: a parcel on a run must name the run''s rider. Deferred '
  'because assign_trip_rider updates trips and orders in separate statements.';
