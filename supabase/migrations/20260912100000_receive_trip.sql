-- ============================================================================
--  MINGALAR EXPRESS  ·  0040 — THE PARCELS ARRIVED AT THE OFFICE
--
--  The operating model is hub-and-spoke and has been since 0028: a parcel is
--  collected from its shop onto a `pickup` run, comes to the hub, and goes out
--  again on a `delivery` run. `orders.picked_up_at` says which side of the hub
--  it is on, and `load_trip` refuses both wrong directions.
--
--  What the model never had is a MOMENT WHEN THE PARCELS ARRIVE.
--
--  ---------------------------------------------------------------------------
--  THE DEAD WINDOW THIS CLOSES
--
--  A collected parcel keeps `trip_id` until `close_trip` detaches it. Every
--  dispatchable pool on the board filters `trip_id is null`, and `unload_trip`
--  deliberately refuses a `picked_up` row because close_trip pays on it. So
--  between the rider tapping "I have the parcel" and somebody pressing
--  "Close & pay", the parcel is real, physically in the building, and movable
--  by nobody at all.
--
--  Observed on staging while writing this: eight parcels, all collected, run
--  `returned`, rider standing in the office with the armful — and zero of them
--  loadable onto a delivery run. The office's whole afternoon, gated behind a
--  button labelled after payroll.
--
--  That conflation is the actual bug. `close_trip` is doing two unrelated jobs:
--
--      INVENTORY   these parcels are on our shelf now
--      PAYROLL     this is what the rider earned today
--
--  The first happens when the bike arrives. The second happens when the office
--  is ready to settle, which may be hours later or after the cash is counted.
--  Welding them together means you cannot sort the shelf until you have decided
--  to pay, and cannot delay paying without freezing the shelf.
--
--  `receive_trip` is the first job on its own.
--
--  ---------------------------------------------------------------------------
--  AND IT MUST NOT COST THE RIDER THEIR MORNING
--
--  This is the part to get right. `close_trip` counts pickups for pay with
--
--      count(*) filter (where o.trip_leg = 'pickup' ...) where o.trip_id = p_trip_id
--
--  -- parcels STILL ATTACHED to the run. Detaching them first makes that count
--  zero, and a rider who cleared thirty parcels off five counters would be paid
--  for none of them. The failure is silent: the run closes, the ledger line is
--  smaller, and nobody notices until the rider does.
--
--  So `receive_trip` BANKS the count into `trips.pickup_count` before it
--  detaches, and `close_trip` stops counting pickups from scratch: it ADDS what
--  is still attached to what was already banked. Three cases, one expression:
--
--      never received      banked 0  + counted N  = N   (unchanged behaviour)
--      received in full    banked N  + counted 0  = N
--      received, then more banked N1 + counted N2 = N1+N2
--
--  The last case is reachable since 0039 let a departed run take new parcels:
--  a rider can drop a load at the office and go out for more on the same run.
--
--  `pickup_count` is `not null default 0` (0007), so the arithmetic is safe on
--  every existing row without a backfill.
--
--  ---------------------------------------------------------------------------
--  WHAT THIS IS NOT
--
--  NOT AUTOMATIC ON `return_trip`. That RPC is a statement about the BIKE --
--  it writes `trips.status` and touches no order row. Shelving on it would mean
--  nobody ever confirmed the parcels came off the bike, and a parcel lost in
--  transit would sit on the shelf as far as the system was concerned. Receiving
--  is a person saying "these are here".
--
--  NOT A COUNT. One press declares the whole armful present -- no scan, no
--  per-parcel tick. That is honest at eight parcels a day and wants revisiting
--  at eighty; what it replaces is not a count either, it is the same bulk
--  declaration hidden inside close_trip.
--
--  Forward-only: a new function, plus one arithmetic change in close_trip that
--  is a no-op for any run that was never received.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. receive_trip — the inventory half, on its own
-- ----------------------------------------------------------------------------

create or replace function public.receive_trip(p_trip_id uuid)
returns public.trips
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.trips;
  v_n integer;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_t from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  /*
    `departed` as well as `returned`, because since 0039 a run can be topped up
    after it leaves -- so a rider may drop one load at the office and ride out
    again on the same run. A `planned` or `loading` run has collected nothing
    yet; a `closed` one already shelved everything on the way past.
  */
  if v_t.status not in ('departed','returned') then
    raise exception 'trip_not_receivable: %', v_t.status using errcode = '55000',
      hint = 'Only a run that has left the hub can bring parcels back to it.';
  end if;

  -- Exactly close_trip's release predicate. A pickup leg is complete at
  -- `picked_up`; `delivered` is included for the same historical reason it is
  -- there -- rows that predate the 0029 guard.
  select count(*) into v_n
    from public.orders o
   where o.trip_id = p_trip_id
     and o.trip_leg = 'pickup'
     and o.status in ('picked_up', 'delivered');

  if v_n = 0 then
    raise exception 'nothing_to_receive' using errcode = '55000',
      hint = 'This run has no collected parcels waiting to be shelved.';
  end if;

  /*
    BANK THE COUNT BEFORE DETACHING. See the header: close_trip pays on
    parcels still attached, so the detach below would otherwise erase the
    rider's collection pay. Adding rather than assigning keeps a second receive
    on the same run correct.
  */
  update public.trips
     set pickup_count = pickup_count + v_n
   where id = p_trip_id
  returning * into v_t;

  /*
    Status is deliberately NOT changed -- it stays `picked_up`. 0027 explains
    why: a parcel reset to `pending` would be indistinguishable from one still
    sitting in a shop, and the next dispatcher could send a rider across Yangon
    to collect something already on our own shelf. `picked_up_at` is what puts
    it in the hub pool, and it survives untouched.
  */
  update public.orders o
     set trip_id  = null,
         trip_leg = null
   where o.trip_id = p_trip_id
     and o.trip_leg = 'pickup'
     and o.status in ('picked_up', 'delivered');

  perform public.write_audit('trip.receive', 'trips', v_t.id::text, null,
    jsonb_build_object('shelved', v_n, 'pickup_count_after', v_t.pickup_count));

  return v_t;
end $$;

comment on function public.receive_trip is
  'The parcels came off the bike. Detaches every collected pickup leg so it '
  'lands in the hub pool and can be sorted onto a delivery run, banking the '
  'count into trips.pickup_count first so close_trip still pays the rider for '
  'collecting them. The inventory half of close_trip, separated from the '
  'payroll half so the office can sort the shelf without settling the day.';

grant execute on function public.receive_trip(uuid) to authenticated;
revoke execute on function public.receive_trip(uuid) from anon;

-- ----------------------------------------------------------------------------
-- 2. close_trip — pay on what was banked plus what is still aboard
--
--  0025's body. One expression changes: `v_pickups`.
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

  /*
    0040: ADD WHAT WAS ALREADY SHELVED.

    `receive_trip` detaches collected pickups so the office can sort them
    hours before the run is settled, and banks how many into
    `trips.pickup_count` on the way past. The count above only sees what is
    still attached, so without this line a received run pays the rider nothing
    for the morning -- silently, because the run closes fine and only the
    ledger line is short.

    A run that was never received has `pickup_count` at its default 0, so this
    is exactly the old arithmetic for every existing row.
  */
  v_pickups := v_pickups + coalesce(v_t.pickup_count, 0);

  v_q     := public.quote_trip_pay(v_parcels, v_pickups, v_t.route_id);
  v_total := (v_q ->> 'total')::bigint;

  update public.trips set
      status            = 'closed',
      closed_at         = now(),
      returned_at       = coalesce(returned_at, now()),
      parcel_count      = v_parcels,
      -- The total, not the increment: v_pickups already includes what
      -- receive_trip banked, so this is assignment and not double counting.
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

    Still here, and still necessary: `receive_trip` is optional. A run closed
    without ever being received shelves its collections right here, exactly as
    before. On a run that WAS received this matches nothing, because those rows
    already have a null trip_id.
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

comment on function public.close_trip is
  'The pay event, and terminal. 0040: pickups are counted as those still on the '
  'run PLUS those already banked by receive_trip, so shelving parcels early to '
  'sort them never costs the rider their collection pay.';
