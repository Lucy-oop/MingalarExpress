-- ============================================================================
-- 0051. NOR WITH PARCELS THE RIDER NEVER COLLECTED
--
-- 0050 stopped close_trip shelving collected parcels nobody had ticked off.
-- It left the other half open: a pickup the rider was sent for and neither
-- collected nor reported failed -- still `assigned` (or `pending`, on a run
-- loaded before it had a rider). close_trip counted open DELIVERY and RETURN
-- legs only, so the run closed and the parcel stayed attached to it: trip_id
-- pointing at a closed run, which every pool on the board filters out. The
-- parcel was at the shop, owed a collection, and invisible to everyone.
--
-- NOW IT REFUSES that too. Every pickup on the run must be resolved first:
-- collected and received (0050), reported failed by the rider (close_trip
-- releases those, as before), or unloaded by the office -- unload_trip puts it
-- back to `pending` at its shop, where the Pickup ways list shows it again.
--
-- Everything else is 0050's close_trip verbatim.
-- ============================================================================

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
  v_unrecv   integer;
  v_uncoll   integer;
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

  /*
    0050: EVERY COLLECTED PARCEL MUST HAVE BEEN RECEIVED. See the header.
    Same predicate receive_trip_parcels shelves on, so "what the checklist
    can tick" and "what blocks closing" can never disagree.
  */
  select count(*) into v_unrecv
    from public.orders o
   where o.trip_id = p_trip_id
     and o.trip_leg = 'pickup'
     and o.status in ('picked_up', 'delivered');
  if v_unrecv > 0 then
    raise exception 'trip_has_unreceived_pickups: %', v_unrecv using errcode = '55000',
      hint = 'Tick the collected parcels off in Received at office before closing the run.';
  end if;

  /*
    0051: AND EVERY PICKUP THE RIDER NEVER COLLECTED MUST BE RESOLVED -- reported
    failed by the rider, or unloaded back to its shop by the office. Left
    attached, it would point at a closed run and vanish from every pool.
  */
  select count(*) into v_uncoll
    from public.orders o
   where o.trip_id = p_trip_id
     and o.trip_leg = 'pickup'
     and o.status in ('pending', 'assigned');
  if v_uncoll > 0 then
    raise exception 'trip_has_uncollected_pickups: %', v_uncoll using errcode = '55000',
      hint = 'Send the parcels the rider did not collect back to the pickup list before closing.';
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

  -- 0050: the shelving that used to happen here is gone. The guard above
  -- guarantees there is nothing collected left on the run to shelve.

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
  'Terminal. Refuses while any collected pickup is unreceived (0050) or any '
  'pickup was never collected and not resolved (0051), so no parcel is left on '
  'a closed run. Pickups paid are those receive_trip / receive_trip_parcels '
  'banked. 0042: on a per_parcel route it books NO trip_pay line.';
