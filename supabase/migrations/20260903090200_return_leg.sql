-- ============================================================================
--  MINGALAR EXPRESS  ·  0013 — THE RETURN LEG
--
--  0011 let a shop say "bring it back" and recorded the decision. Nothing could
--  act on it: the office carried parcels home by hand because a return had no
--  way to travel and no way to end.
--
--  This gives it both. A parcel with `resolution = 'return'` can be loaded onto
--  a run as a RETURN leg, whose destination is the shop's own pickup point, and
--  the rider ends it at `returned` -- a terminal status that is deliberately not
--  `delivered`.
--
--  WHY NOT JUST MARK IT DELIVERED. Because `cod_by_shop` counts `delivered` as
--  revenue. A return that ended in `delivered` would charge the shop a delivery
--  fee for a parcel that came back, and would book it as income the platform
--  never earned. Keeping `returned` distinct is what makes the "no return fee"
--  decision hold without a single line of pricing code.
--
--  THREE DECISIONS TAKEN, all visible below:
--    Proof     a receiver NAME is required, a photo is not. The dispute a return
--              invites is "you never brought it back", which a name and a
--              timestamp answer; a mandatory photo is friction on a leg that
--              earns nothing.
--    Rider pay a return leg counts as a parcel (the standard per-parcel rate).
--              The rider carried it. Five returns to one shop is one stop and
--              slightly overpays; not worth modelling.
--    COD       return parcels are excluded from `max_cod_per_trip`. Nothing is
--              collected on them, so counting their cod_amount would eat float
--              headroom for money that will never exist.
--
--  Depends on 0012 for the enum value. Forward-only.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. A third kind of leg, and the evidence a return needs
-- ----------------------------------------------------------------------------

alter table public.orders drop constraint if exists orders_trip_leg_check;
alter table public.orders
  add constraint orders_trip_leg_check
    check (trip_leg is null or trip_leg in ('delivery','pickup','return'));

comment on column public.orders.trip_leg is
  'delivery : carried out from the hub and dropped at the customer. '
  'pickup   : collected on the return leg and brought back to the hub. '
  'return   : carried BACK to the shop that sent it, after resolution=''return''. '
  'A return leg''s destination is orders.pickup_address, not dropoff_address.';

alter table public.orders drop constraint if exists orders_returned_needs_receiver;
alter table public.orders
  -- The counterpart of orders_delivered_needs_proof. A return with nobody's name
  -- on it is a parcel the shop can truthfully say never arrived.
  add constraint orders_returned_needs_receiver
    check (status <> 'returned' or proof_receiver is not null);


-- ----------------------------------------------------------------------------
-- 2. STATUS MACHINE — where `returned` can be reached from
--
--  Only §"v_ok" and the timestamp branch differ from 0002; the rest is that body
--  unchanged so the whole machine still reads in one place.
--
--  A parcel can be returned from four places, because a shop can ask for one
--  back at four different moments:
--
--    pending    auto-retried by close_trip, shop changed its mind, office hands
--               it over the counter
--    assigned   loaded onto a return run
--    picked_up  rider has it in hand on the way to the shop
--    failed     stopped at the attempt cap, collected from the office
--
--  And it is gated: `returned` is refused unless `resolution = 'return'`. Without
--  that a rider could quietly close any awkward parcel as a return.
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
      new.picked_up_at            := null;
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
-- 3. advance_order — the rider's fourth outcome
--
--  Only the accepted-target list and the receiver guard are new.
-- ----------------------------------------------------------------------------

create or replace function public.advance_order(
  p_order_id uuid,
  p_to       public.order_status,
  p_lat      double precision default null,
  p_lng      double precision default null,
  p_proof    text default null,
  p_receiver text default null,
  p_reason   text default null
) returns public.orders
language plpgsql security definer
set search_path = public
as $$
declare v_o public.orders;
begin
  if p_to not in ('picked_up','delivered','failed','returned') then
    raise exception 'advance_order handles picked_up | delivered | failed | returned only'
      using errcode = '22023';
  end if;

  select * into v_o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  if v_o.rider_id is distinct from auth.uid()
     and not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_to = 'delivered' and coalesce(p_proof, v_o.proof_photo_path) is null then
    raise exception 'proof_required'
      using errcode = '55000',
            hint = 'Upload to the delivery-proofs bucket first, then pass its object path.';
  end if;

  -- A NAME, not a photo. See the header: the dispute a return invites is "you
  -- never brought it back", and a name plus a timestamp answers it. A photo is
  -- still accepted and stored if the rider takes one.
  if p_to = 'returned' and coalesce(nullif(trim(p_receiver), ''), v_o.proof_receiver) is null then
    raise exception 'receiver_required'
      using errcode = '55000',
            hint = 'Record who at the shop took the parcel back.';
  end if;

  if p_to = 'failed' and coalesce(nullif(trim(p_reason), ''), v_o.fail_reason) is null then
    raise exception 'fail_reason_required' using errcode = '55000';
  end if;

  perform set_config('app.event_lat',  coalesce(p_lat::text, ''), true);
  perform set_config('app.event_lng',  coalesce(p_lng::text, ''), true);
  perform set_config('app.event_note', coalesce(p_reason, ''),    true);

  update public.orders set
      status           = p_to,
      proof_photo_path = coalesce(p_proof, proof_photo_path),
      proof_receiver   = coalesce(nullif(trim(p_receiver), ''), proof_receiver),
      fail_reason      = case when p_to = 'failed'
                              then coalesce(nullif(trim(p_reason), ''), fail_reason)
                              else fail_reason end
   where id = p_order_id
   returning * into v_o;

  perform set_config('app.event_lat', '', true);
  perform set_config('app.event_lng', '', true);
  perform set_config('app.event_note', '', true);

  return v_o;
end $$;


-- ----------------------------------------------------------------------------
-- 4. load_trip — a return leg is loaded, not improvised
--
--  Three changes, all guards. The rest is 0008's body.
--
--    * a parcel the shop asked back can ONLY go on a `return` leg, and a normal
--      parcel can never go on one. Mixing them is how a customer ends up
--      receiving a parcel that was supposed to come home.
--    * return parcels do not count toward max_cod_per_trip
--    * a return leg's cod_status is 'none' -- there is nothing to collect
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
         rider_id    = coalesce(v_t.rider_id, o.rider_id),
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
-- 4b. depart_trip — a run of nothing but returns is still a run
--
--  Its volume count only looked at 'delivery' and 'pickup' legs, so a run
--  carrying returns alone counted zero parcels and was refused as `trip_empty`.
--  Return legs now count toward volume, consistent with the pay close_trip
--  books for them.
--
--  This also means the 20-parcel minimum applies to returns. That is the right
--  reading: the cost of sending a bike out does not depend on which direction
--  the parcels are travelling.
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
   where trip_id = p_trip_id and status in ('pending','failed');

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
-- 5. close_trip — a return leg is work, and it blocks the close like any other
--
--  Two changes from 0011:
--    * the open-orders guard covers return legs. A run cannot be closed with a
--      parcel still on its way home any more than with one still out.
--    * a completed return counts toward the rider's parcel pay. They carried it.
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
                         and public.order_attempt_count(o.id) < coalesce(v_max, 3)),
      count(*) filter (where o.resolution is null
                         and public.order_attempt_count(o.id) >= coalesce(v_max, 3))
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
                      when public.order_attempt_count(o.id) < coalesce(v_max, 3)
                        then 'pending'::public.order_status
                      else o.status
                    end
   where o.trip_id = p_trip_id
     and o.status = 'failed';

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


-- ----------------------------------------------------------------------------
-- 6. The unrouted index now has a third state to ignore
-- ----------------------------------------------------------------------------

drop index if exists public.orders_unrouted_idx;
create index orders_unrouted_idx on public.orders (dropoff_area_id, created_at)
  where trip_id is null and status = 'pending';

comment on constraint orders_returned_needs_receiver on public.orders is
  'A return with nobody''s name against it is a parcel the shop can truthfully '
  'say never came back. The rider records who took it.';
