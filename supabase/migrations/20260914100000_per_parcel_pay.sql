-- ============================================================================
--  MINGALAR EXPRESS  ·  0042 — THE RIDER IS PAID AS THEY WORK
--
--  Requested: 500 Ks per parcel collected, 70% of the delivery fee per parcel
--  delivered, landing in "earned today" AT THE MOMENT the rider taps Done
--  rather than when the office closes the run.
--
--  ---------------------------------------------------------------------------
--  THE MACHINERY WAS ALREADY BUILT AND NEVER GIVEN A NUMBER
--
--  `tg_orders_audit` has always booked a `commission_earned` line the instant a
--  parcel reaches `delivered` -- but only `if rider_commission_amount > 0`, and
--  that column is written exclusively by `assign_order`, which refuses any
--  trip-attached order. The route board reaches parcels through `load_trip`,
--  which never stamped it. So the per-parcel pay path, every aggregate that
--  sums it, and `earned_today` itself have all been wired and idle: the rider
--  saw 0 all day and the money appeared only when the office closed the run.
--
--  This migration hands that machinery its number.
--
--  ---------------------------------------------------------------------------
--  A BRANCH, NOT A CUTOVER — AND THE SWITCH ALREADY EXISTED
--
--  `routes.pay_model` has been `check (pay_model in ('trip','per_parcel'))`
--  since 0007, default 'trip', read into the board payload, and **nothing has
--  ever branched on it.** 0007's own header says why it was put there:
--
--      "`routes.pay_model` stays a per-route column rather than a global flag
--       so a per-parcel route can be added without a migration."
--
--  This is that route. Every seeded route is 'trip', so every existing pay
--  assertion -- R1's eight exact quotes, R6b's snapshot, R6c's single ledger
--  line, R6d's "a route run books no commission", R9a's receive/close parity --
--  comes through untouched. The office switches routes over one at a time and
--  can switch back.
--
--  ---------------------------------------------------------------------------
--  THE SHARE IS A SETTING, DELIBERATELY
--
--  `app_settings.rider_commission_pct` (default 80) with a per-rider override
--  at `rider_profiles.commission_pct_override` already exists and is already
--  editable on the pricing screen. 70% is not hard-coded here, because the
--  arithmetic says it is right at today's volume and wrong later:
--
--      parcels/day   platform on 'trip'   platform on 70%
--            5            -14,000              +3,500
--            8             -4,400              +5,600
--           12              8,400               8,400
--           20             29,000              14,000
--           30             61,000              21,000
--
--  70% is a flat 17.5% margin at any volume; the per-run model has a fixed
--  cost and so improves with scale. The crossover is 12 parcels a day. Below
--  it this rescues the business, above it it gives away the upside -- so the
--  number must stay the owner's to change without a migration.
--
--  ---------------------------------------------------------------------------
--  THE TRAP THAT WOULD HAVE PAID TWICE
--
--  Pickup pay cannot reuse `commission_earned`: `cod_ledger_order_kind_uk` is
--  unique on `(order_id, kind)`, so a 500 at pickup and a 2,800 at delivery on
--  the same parcel would collide -- and every writer uses `on conflict do
--  nothing`, so the second would be SILENTLY DROPPED and the rider would lose
--  the delivery pay.
--
--  So `pickup_pay` is a new kind. And it MUST join that index, because without
--  it a per-parcel pay line has no idempotency backstop at all -- and the
--  rider app replays `advance_orders` from IndexedDB hours later, so a
--  collection saved offline would book the 500 twice.
--
--  TWO FILES. The `pickup_pay` enum value is added by
--  `20260914090000_pickup_pay_enum.sql` because Postgres refuses to use a new
--  enum value in the transaction that created it -- see section 1. Apply that
--  one first.
--
--  Forward-only. A new enum value, a widened index, three redefinitions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The index that makes the new kind safe
--
--  THE ENUM VALUE IS ADDED BY `20260914090000_pickup_pay_enum.sql`, one file
--  earlier, and for a reason worth reading before merging the two back
--  together:
--
--      ERROR: 55P04: unsafe use of new value "pickup_pay" of enum type
--                    ledger_kind
--      HINT:  New enum values must be committed before they can be used.
--
--  Postgres will not let a new enum value be USED in the transaction that
--  added it, and the index predicate below uses it. This file originally
--  carried the `alter type` itself, on the reasoning that `psql -f` is
--  autocommit -- true of both tools in this repo, which is why db:verify
--  passed, and NOT true of the Supabase SQL editor, which wraps a pasted
--  script in one transaction and is how this project is actually migrated.
-- ----------------------------------------------------------------------------

/*
  THE IDEMPOTENCY BACKSTOP, WIDENED. 0002 created this over cod_collected and
  commission_earned so a retried delivery could not double-book. `pickup_pay`
  needs it more than either: collections are recorded in BULK by
  `advance_orders` from a shop counter, and the offline queue replays that call
  from IndexedDB when signal returns. Without the index the replay pays the
  500 again, per parcel, silently.

  Dropped and recreated rather than added to, because a partial index's
  predicate cannot be altered in place.
*/
drop index if exists public.cod_ledger_order_kind_uk;
create unique index cod_ledger_order_kind_uk on public.cod_ledger (order_id, kind)
  where kind in ('cod_collected', 'commission_earned', 'pickup_pay');

-- ----------------------------------------------------------------------------
-- 2. load_trip — stamp the commission on a per_parcel delivery leg
--
--  0039's body. One block added before the UPDATE and three columns added to
--  it; everything else is byte-identical.
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
  v_pct       numeric(5,2);
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
  -- 0039: `departed` is loadable. A rider on the road can be given more work.
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

  -- 0028: collect first, then deliver. picked_up_at says which side of the hub
  -- a parcel is on; a delivery run may only carry what we hold.
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

  select count(*) into v_held
    from public.orders o
   where o.id = any(v_ids) and o.status = 'picked_up';
  if v_held > 0 and v_t.rider_id is null then
    raise exception 'trip_needs_rider_for_held_parcels: % parcel(s)', v_held
      using errcode = '55000',
            hint = 'Assign a rider to this run before loading parcels already at the hub.';
  end if;

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

  /*
    0042: THE COMMISSION STAMP. This is the whole change.

    On a `per_parcel` route, a delivery leg snapshots the rider's share of the
    fee onto each parcel -- the same three columns, computed the same way, as
    `assign_order` has always done for the point-to-point path. That is what
    makes `tg_orders_audit` book a `commission_earned` line the moment the
    rider taps Done, which is what makes "earned today" move while they work.

    SNAPSHOTTED, NOT LOOKED UP LATER, for the reason 0001 gives about
    `orders.rider_commission_pct`: repricing next month must not silently
    restate what a rider earned last month.

    v_pct stays NULL on a 'trip' route and on pickup/return legs, and the
    UPDATE below leaves the columns untouched in that case -- so this is a
    no-op for every route the office has not switched over.
  */
  if v_r.pay_model = 'per_parcel' and p_leg = 'delivery' and v_t.rider_id is not null then
    select coalesce(rp.commission_pct_override, s.rider_commission_pct)
      into v_pct
      from public.app_settings s
      left join public.rider_profiles rp on rp.id = v_t.rider_id
     where s.id;
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
         -- 0042. The platform takes the remainder so
         -- orders_commission_split_sane (commission + fee_amount = delivery_fee)
         -- holds exactly, as it does on the assign_order path.
         rider_commission_pct =
           case when v_pct is null then o.rider_commission_pct else v_pct end,
         rider_commission_amount =
           case when v_pct is null then o.rider_commission_amount
                else floor(o.delivery_fee * v_pct / 100.0)::bigint end,
         platform_fee_amount =
           case when v_pct is null then o.platform_fee_amount
                else o.delivery_fee - floor(o.delivery_fee * v_pct / 100.0)::bigint end,
         fail_reason = null
   where o.id = any(v_ids);

  -- Only a PLANNED run advances to `loading`; a departed one stays departed.
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
                       'after_departure', v_t.status = 'departed',
                       'commission_pct', v_pct));
  return v_t;
end $$;

comment on function public.load_trip is
  'Attach parcels to a run on a given leg. 0028: collect before deliver. 0039: '
  'a departed run still accepts parcels. 0042: on a per_parcel route a delivery '
  'leg snapshots the rider''s fee share onto each parcel, which is what makes '
  'tg_orders_audit book their pay the moment they tap Done.';

-- ----------------------------------------------------------------------------
-- 3. tg_orders_audit — pay the collection at the moment it happens
--
--  0021's body. One block added (5d); 5a, 5b and 5c are byte-identical.
-- ----------------------------------------------------------------------------

create or replace function public.tg_orders_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lat   double precision := nullif(current_setting('app.event_lat',  true), '')::double precision;
  v_lng   double precision := nullif(current_setting('app.event_lng',  true), '')::double precision;
  v_note  text            := nullif(current_setting('app.event_note', true), '');
  v_model text;
  v_rate  bigint;
begin
  -- 5a. checkpoint trail -----------------------------------------------------
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_status_events
      (order_id, from_status, to_status, actor_id, actor_role, lat, lng, note)
    values
      (new.id,
       case when tg_op = 'UPDATE' then old.status end,
       new.status,
       auth.uid(),
       public.auth_role(),
       v_lat, v_lng,
       coalesce(v_note, new.fail_reason, new.cancel_reason));
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  -- 5b. release rider capacity ---------------------------------------------
  if old.rider_id is not null
     and old.trip_id is null
     and old.status in ('assigned','picked_up')
     and (new.status in ('delivered','failed','cancelled','pending')
          or new.rider_id is distinct from old.rider_id) then
    perform set_config('app.rider_guard_bypass', 'on', true);
    update public.rider_profiles
       set active_order_count = greatest(active_order_count - 1, 0),
           availability       = 'available'
     where id = old.rider_id;
    perform set_config('app.rider_guard_bypass', 'off', true);
  end if;

  -- 5c. COD ledger on delivery ---------------------------------------------
  --   + cod_amount              (rider now holds the platform's cash)
  --   - rider_commission_amount (platform now owes the rider their cut)
  --
  -- 0042: the commission columns are no longer NULL on a route parcel. A
  -- `per_parcel` route has them stamped by load_trip, so THIS is where the
  -- 70% lands -- at the moment of delivery, unchanged code. A 'trip' route
  -- still leaves them NULL and still books nothing here.
  if new.status = 'delivered' and old.status <> 'delivered' and new.rider_id is not null then
    -- THE KPAY BRANCH (0021). A KPay transfer never passes through the rider's
    -- hands, so their ledger must not mention it and settlement must not ask
    -- them for it.
    if new.payment_method = 'cod' and new.cod_amount > 0
       and coalesce(new.collected_via, 'cash') <> 'kpay' then
      insert into public.cod_ledger (order_id, rider_id, kind, amount, created_by, memo)
      values (new.id, new.rider_id, 'cod_collected', new.cod_amount,
              coalesce(auth.uid(), new.rider_id), new.code)
      on conflict do nothing;
    end if;

    if coalesce(new.rider_commission_amount, 0) > 0 then
      /*
        0042: `trip_id` IS NOW SET ON THIS LINE. It used to be the trip_pay
        line's alone. A per-parcel pay line has to stay attributable to the run
        that earned it, because close_trip sums them for trips.total_pay and by
        then the parcel may already have been DETACHED -- receive_trip nulls
        orders.trip_id hours earlier, and a sum through the orders table then
        finds nothing. Learned by writing it the other way first and watching
        total_pay come out 0.
      */
      insert into public.cod_ledger
        (order_id, trip_id, rider_id, kind, amount, created_by, memo)
      values (new.id, new.trip_id, new.rider_id, 'commission_earned',
              -new.rider_commission_amount,
              coalesce(auth.uid(), new.rider_id), new.code)
      on conflict do nothing;
    end if;
  end if;

  /*
    5d. 0042 — PAY THE COLLECTION WHEN IT IS COLLECTED.

    The delivery half above earns its money through a column snapshotted at
    load time. A collection has no fee of its own to take a share of, so it is
    paid a flat rate per parcel -- `app_settings.route_pickup_rate`, the same
    500 the per-run model already used for pickups.

    ON THE EDGE INTO `picked_up`, not on every update: `old.status is distinct
    from 'picked_up'` makes a second write idempotent even before the index
    below catches it.

    A NEW KIND, not `commission_earned`: cod_ledger_order_kind_uk is unique on
    (order_id, kind), so reusing it would make a parcel's 500 and its 2,800
    collide and `on conflict do nothing` would drop the second SILENTLY. See
    the header.

    `> 0` because cod_ledger_nonzero refuses a zero line -- a rate set to 0
    means "do not pay for collections", not "raise".
  */
  if new.status = 'picked_up' and old.status is distinct from 'picked_up'
     and new.trip_leg = 'pickup' and new.rider_id is not null
     and new.trip_id is not null then
    select r.pay_model into v_model
      from public.trips t join public.routes r on r.id = t.route_id
     where t.id = new.trip_id;

    if v_model = 'per_parcel' then
      select s.route_pickup_rate into v_rate from public.app_settings s where s.id;
      if coalesce(v_rate, 0) > 0 then
        insert into public.cod_ledger
          (order_id, trip_id, rider_id, kind, amount, created_by, memo)
        values (new.id, new.trip_id, new.rider_id, 'pickup_pay', -v_rate,
                coalesce(auth.uid(), new.rider_id), new.code)
        on conflict do nothing;
      end if;
    end if;
  end if;

  return new;
end $$;

comment on function public.tg_orders_audit is
  'The checkpoint trail, the rider capacity release, and the money. 0042: on a '
  'per_parcel route a collection books its own pickup_pay line the moment the '
  'rider taps, and a delivery books commission_earned off the share load_trip '
  'snapshotted -- so "earned today" moves while the rider works instead of '
  'when the office closes the run.';

-- ----------------------------------------------------------------------------
-- 4. close_trip — do not pay twice
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
  v_per      boolean;
  v_com_paid bigint;
  v_pic_paid bigint;
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
  v_per := v_r.pay_model = 'per_parcel';

  select count(*) into v_open
    from public.orders o
   where o.trip_id = p_trip_id
     and o.trip_leg in ('delivery','return')
     and o.status in ('pending','assigned','picked_up');
  if v_open > 0 then
    raise exception 'trip_has_open_orders: %', v_open using errcode = '55000',
      hint = 'Every parcel must be delivered, returned, failed or cancelled before close.';
  end if;

  select
      count(*) filter (where o.trip_leg = 'delivery' and o.status in ('delivered','failed'))
    + count(*) filter (where o.trip_leg = 'return'   and o.status in ('returned','failed')),
      count(*) filter (where o.trip_leg = 'pickup'   and o.status in ('picked_up','delivered'))
    into v_parcels, v_pickups
    from public.orders o
   where o.trip_id = p_trip_id;

  -- 0040: add what receive_trip already shelved and banked.
  v_pickups := v_pickups + coalesce(v_t.pickup_count, 0);

  /*
    0042: A per_parcel RUN HAS ALREADY PAID ITSELF.

    Every parcel booked its own line as it happened -- commission_earned on
    delivery, pickup_pay on collection. Quoting the per-run tiers on top would
    pay the rider twice for the same work, which is the one mistake in this
    area that nobody would notice until payday.

    The snapshot columns are filled from what was ACTUALLY BOOKED rather than
    left at zero, because `trips.total_pay` is what /rider/ways shows as the
    earnings of a run, and a run that paid 66,000 must not read 0 in the
    rider's own history. `trips_pay_sums` (total = base + parcel + pickup)
    holds with base_pay at 0.
  */
  if v_per then
    /*
      SUMMED BY `l.trip_id`, NOT through the orders table. receive_trip nulls
      orders.trip_id when it shelves the collections, so by the time a run is
      closed its parcels may no longer point at it -- the first version of this
      went through orders and produced total_pay 0 on exactly the runs the
      office had shelved early. The ledger line carries the run itself.
    */
    select
        coalesce(-sum(l.amount) filter (where l.kind = 'commission_earned'), 0),
        coalesce(-sum(l.amount) filter (where l.kind = 'pickup_pay'), 0)
      into v_com_paid, v_pic_paid
      from public.cod_ledger l
     where l.trip_id = p_trip_id;

    v_q := jsonb_build_object(
             'pay_model',  'per_parcel',
             'parcels',    v_parcels,
             'pickups',    v_pickups,
             'base_pay',   0,
             'parcel_pay', v_com_paid,
             'pickup_pay', v_pic_paid,
             'total',      v_com_paid + v_pic_paid,
             'note',       'booked per parcel as the rider worked; see cod_ledger');
    v_total := v_com_paid + v_pic_paid;
  else
    v_q     := public.quote_trip_pay(v_parcels, v_pickups, v_t.route_id);
    v_total := (v_q ->> 'total')::bigint;
  end if;

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

  -- 0025/0040: a collection that reached the hub is done. Still needed --
  -- receive_trip is optional, and a run closed without it shelves here.
  update public.orders o
     set trip_id  = null,
         trip_leg = null
   where o.trip_id = p_trip_id
     and o.trip_leg = 'pickup'
     and o.status in ('picked_up', 'delivered');

  -- THE LINE A per_parcel RUN MUST NOT WRITE. Its parcels already did.
  if v_total > 0 and not v_per then
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
      'held_for_shop',        coalesce(v_held, 0),
      'pay_model',            v_r.pay_model));
  return v_t;
end $$;

comment on function public.close_trip is
  'Terminal. 0040: pickups are those still aboard plus those receive_trip '
  'banked. 0042: on a per_parcel route it books NO trip_pay line -- every '
  'parcel paid itself as the rider worked -- and the snapshot columns are '
  'filled from what the ledger actually booked so /rider/ways still shows the '
  'run''s earnings.';

-- ----------------------------------------------------------------------------
-- 5. Every reader that enumerates pay kinds BY NAME
--
--  THE FRAGILITY OF THIS DESIGN, stated plainly: five separate lists name the
--  kinds that mean "the platform owes the rider", and a new kind is only paid
--  once every one of them has been told. 0008's header made the same point
--  about `trip_pay` -- "missing any single one under-reports rider earnings,
--  and in build_settlement's case that means under-PAYING a rider."
--
--  A kind-agnostic rule (amount < 0) would be sturdier and is the right
--  eventual shape; changing five money functions to infer intent from a sign
--  is not what this migration should also be doing.
-- ----------------------------------------------------------------------------

create or replace function public.rider_earnings_summary(p_rider_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_rider uuid := coalesce(p_rider_id, auth.uid());
  v_today date := public.mm_today();
begin
  if v_rider is distinct from auth.uid() and not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'cod_in_hand',      public.rider_cod_in_hand(v_rider),
      'cash_held',        public.rider_cash_held(v_rider),
      -- 0042: pickup_pay joins the pay kinds. This is the number the owner
      -- asked to move as the rider works, and it now does.
      'earned_today',     coalesce((select -sum(l.amount) from public.cod_ledger l
                                    where l.rider_id = v_rider
                                      and l.kind in ('commission_earned','trip_pay','pickup_pay')
                                      and l.created_at >= public.mm_day_start(v_today)), 0),
      'earned_week',      coalesce((select -sum(l.amount) from public.cod_ledger l
                                    where l.rider_id = v_rider
                                      and l.kind in ('commission_earned','trip_pay','pickup_pay')
                                      and l.created_at >= public.mm_day_start(v_today - 6)), 0),
      'trip_pay_today',   coalesce((select -sum(l.amount) from public.cod_ledger l
                                    where l.rider_id = v_rider and l.kind = 'trip_pay'
                                      and l.created_at >= public.mm_day_start(v_today)), 0),
      'delivered_today',  coalesce((select count(*) from public.orders o
                                    where o.rider_id = v_rider and o.status = 'delivered'
                                      and o.delivered_at >= public.mm_day_start(v_today)), 0),
      -- 0041: from the append-only event trail, because trip_leg flips to
      -- 'delivery' when the office sorts the shelf and erased this.
      'picked_up_today',  coalesce((select count(*)
                                      from public.order_status_events e
                                      join public.orders o on o.id = e.order_id
                                     where e.to_status = 'picked_up'
                                       and e.created_at >= public.mm_day_start(v_today)
                                       and (e.actor_id = v_rider or o.rider_id = v_rider)), 0),
      'active_orders',    coalesce((select count(*) from public.orders o
                                    where o.rider_id = v_rider
                                      and o.status in ('assigned','picked_up')), 0),
      'active_trip',      (select jsonb_build_object(
                                    'id', t.id, 'route', r.code, 'colour', r.colour,
                                    'status', t.status, 'service_date', t.service_date)
                             from public.trips t join public.routes r on r.id = t.route_id
                            where t.rider_id = v_rider
                              and t.status in ('planned','loading','departed')
                            limit 1),
      'unsettled_since',  (select min(l.created_at) from public.cod_ledger l
                            where l.rider_id = v_rider and l.settlement_id is null)
    )
  );
end $$;

/*
  build_settlement — THE ONE THAT MOVES MONEY.

  0008's body verbatim, with a single filter widened. Reproduced whole because
  `create or replace` cannot patch a statement, and NOT rewritten from memory:
  the real function carries a period_date lookup, a `settlement_locked` guard,
  fee reachability through both order lines and whole trips, and a
  `cod_status = 'settled'` sweep. A plausible-looking reconstruction would have
  silently dropped all of that.
*/
create or replace function public.build_settlement(
  p_rider_id uuid,
  p_date     date default null
) returns public.settlements
language plpgsql security definer
set search_path = public
as $$
declare
  v_s    public.settlements;
  v_date date := coalesce(p_date, public.mm_today());
  v_end  timestamptz;
begin
  if not (public.is_admin() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_end := public.mm_day_end(v_date);

  select * into v_s from public.settlements
   where rider_id = p_rider_id and period_date = v_date
   for update;

  if found and v_s.status in ('approved','paid') then
    raise exception 'settlement_locked: %', v_s.status
      using errcode = '55000',
            hint = 'Reverse with an adjustment ledger entry instead of rebuilding.';
  end if;

  if not found then
    insert into public.settlements (rider_id, period_date, status)
    values (p_rider_id, v_date, 'open')
    returning * into v_s;
  end if;

  update public.cod_ledger
     set settlement_id = v_s.id
   where rider_id = p_rider_id
     and settlement_id is null
     and created_at < v_end;

  update public.settlements s set
      gross_cod        = t.gross_cod,
      rider_earnings   = t.rider_earnings,
      delivery_fees    = t.delivery_fees,
      platform_share   = t.delivery_fees - t.rider_earnings,
      net_due_platform = t.net_due,
      order_count      = t.order_count,
      status           = 'submitted'
    from (
      select
        coalesce(sum(l.amount) filter (where l.kind = 'cod_collected'), 0)::bigint  as gross_cod,
        -- CHANGED: trip pay is rider earnings too. Without it a route rider's
        -- settlement shows earnings of zero and platform_share swallows the lot.
        -- 0042: pickup_pay joins them. A per_parcel run books no trip_pay at
        -- all, so without this a rider who spent the morning collecting
        -- settles with those 500s counted as platform_share -- i.e. the
        -- platform keeps the rider's pay. Same failure 0008's header warns
        -- about for trip_pay, one kind later.
        coalesce(-sum(l.amount) filter (
          where l.kind in ('commission_earned','trip_pay','pickup_pay')), 0)::bigint
                                                                                    as rider_earnings,
        coalesce(sum(l.amount), 0)::bigint                                          as net_due,
        coalesce((select sum(f.delivery_fee) from (
                    -- Fees reachable two ways: per-order lines (the pre-route
                    -- path) and whole trips (the route path, where a prepaid
                    -- parcel books no ledger line of its own and would otherwise
                    -- be invisible). DISTINCT over order ids, so a COD parcel on
                    -- a trip is not counted twice.
                    select distinct o.id, o.delivery_fee
                      from public.orders o
                     where o.id in (select l2.order_id from public.cod_ledger l2
                                     where l2.settlement_id = v_s.id and l2.order_id is not null)
                        or (o.status = 'delivered'
                            and o.trip_id in (select l3.trip_id from public.cod_ledger l3
                                               where l3.settlement_id = v_s.id
                                                 and l3.trip_id is not null))
                  ) f), 0)::bigint                                                  as delivery_fees,
        coalesce((select count(*) from (
                    select distinct o.id
                      from public.orders o
                     where o.id in (select l2.order_id from public.cod_ledger l2
                                     where l2.settlement_id = v_s.id and l2.order_id is not null)
                        or (o.status = 'delivered'
                            and o.trip_id in (select l3.trip_id from public.cod_ledger l3
                                               where l3.settlement_id = v_s.id
                                                 and l3.trip_id is not null))
                  ) c), 0)                                                          as order_count
      from public.cod_ledger l
     where l.settlement_id = v_s.id
    ) t
   where s.id = v_s.id
   returning s.* into v_s;

  update public.orders o
     set cod_status = 'settled'
   where o.cod_status in ('collected','remitted')
     and exists (select 1 from public.cod_ledger l
                  where l.order_id = o.id and l.settlement_id = v_s.id);

  perform public.write_audit('settlement.build', 'settlements', v_s.id::text,
                             null, to_jsonb(v_s));
  return v_s;
end $$;

/*
  The trip_id comment from 0008 said this column was set on the single trip_pay
  line "and on nothing else". 0042 makes that false: a per-parcel pay line
  carries it too, so the run that earned the money stays identifiable after
  receive_trip has detached the parcels.
*/
comment on column public.cod_ledger.trip_id is
  'The run this line belongs to. Set on a trip_pay line (one per run, enforced '
  'by cod_ledger_trip_pay_uk) and, since 0042, on the per-parcel pickup_pay and '
  'commission_earned lines a per_parcel route books -- so close_trip can still '
  'total a run whose parcels receive_trip already shelved. order_id is NULL on '
  'a trip_pay line and set on the per-parcel ones.';
