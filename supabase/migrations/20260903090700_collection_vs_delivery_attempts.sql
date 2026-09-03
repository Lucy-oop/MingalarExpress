-- ============================================================================
--  MINGALAR EXPRESS  ·  0018 — ONLY A COLLECTED PARCEL BURNS A DELIVERY ATTEMPT
--
--  `assigned -> failed` is a legal transition and it means something quite
--  different from `picked_up -> failed`:
--
--    picked_up -> failed   the rider had the parcel and could not deliver it
--    assigned  -> failed   the rider reached the SHOP and came away empty --
--                          parcel not ready, shop shut, wrong label
--
--  0011 counted both as delivery attempts, so a shop that was closed twice
--  arrived at the 3-attempt ceiling having never handed us anything. The parcel
--  was then held "waiting on the shop" for a decision about a delivery nobody
--  had tried. That is unfair to the merchant and it is bad data: the attempt
--  counter is what the ceiling, the shop's panel and the timeline all read.
--
--  So the two are now counted separately, and each has its own ceiling.
--
--  THE TRAP THIS AVOIDS. Narrowing order_attempt_count alone would have made an
--  uncollected parcel IMMORTAL: close_trip auto-retries anything under the
--  delivery ceiling, an uncollected parcel is permanently at zero, so it would
--  have gone back out every single day forever with nobody ever asked. Hence
--  max_collection_attempts and order_attempts_exhausted() -- the ceiling is now
--  "either count is spent", and close_trip asks that one question instead of
--  doing the arithmetic itself.
--
--  Forward-only.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. A ceiling of its own
--
--  Same default as deliveries, separate on purpose: how many wasted trips to a
--  shop the business will absorb is a different question from how many attempts
--  a customer deserves, and they will diverge.
-- ----------------------------------------------------------------------------

alter table public.app_settings
  add column if not exists max_collection_attempts smallint not null default 3
    check (max_collection_attempts between 1 and 10);

comment on column public.app_settings.max_collection_attempts is
  'How many times a rider will be sent to collect a parcel the shop has not '
  'handed over before it stops and waits for someone. Counts assigned->failed '
  'only; max_delivery_attempts counts picked_up->failed.';


-- ----------------------------------------------------------------------------
-- 2. The two counters
--
--  Both read `from_status`, which tg_orders_audit has recorded on every
--  transition since 0002 -- so this is a reinterpretation of data already there,
--  not a backfill. Every existing parcel re-counts correctly the moment this
--  lands.
--
--  SECURITY INVOKER, as 0011 had it: a shop counts its own parcels via
--  `ose_read`, dispatch counts any, a stranger gets 0 rather than an error that
--  would confirm the order exists.
-- ----------------------------------------------------------------------------

create or replace function public.order_attempt_count(p_order_id uuid)
returns integer
language sql stable security invoker
set search_path = public
as $$
  select count(*)::integer
    from public.order_status_events e
   where e.order_id = p_order_id
     and e.to_status = 'failed'
     -- THE WHOLE CHANGE. A failure the rider could only have reached while
     -- holding the parcel.
     and e.from_status = 'picked_up'
$$;

comment on function public.order_attempt_count is
  'DELIVERY attempts that failed: picked_up -> failed. A parcel the rider never '
  'collected does not appear here -- see order_uncollected_count.';

create or replace function public.order_uncollected_count(p_order_id uuid)
returns integer
language sql stable security invoker
set search_path = public
as $$
  select count(*)::integer
    from public.order_status_events e
   where e.order_id = p_order_id
     and e.to_status = 'failed'
     and e.from_status = 'assigned'
$$;

comment on function public.order_uncollected_count is
  'Trips to the shop that came away empty: assigned -> failed. Charged against '
  'max_collection_attempts, never against the delivery ceiling.';


-- ----------------------------------------------------------------------------
-- 3. order_attempts_exhausted — the one question close_trip asks
--
--  A single definer function so the two ceilings can never be compared in one
--  place and forgotten in another. It is the third time this codebase has been
--  bitten by the same arithmetic living in two functions.
--
--  DEFINER, unlike the counters: close_trip already runs as the owner, but the
--  shop panel wants the same answer under RLS, and a shop reading its own parcel
--  must get the real figure rather than a silent 0 from a policy it does not
--  match on order_status_events.
-- ----------------------------------------------------------------------------

create or replace function public.order_attempts_exhausted(p_order_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_deliveries integer;
  v_collections integer;
  v_max_d smallint;
  v_max_c smallint;
begin
  select s.max_delivery_attempts, s.max_collection_attempts
    into v_max_d, v_max_c
    from public.app_settings s where s.id;

  select
      count(*) filter (where e.from_status = 'picked_up'),
      count(*) filter (where e.from_status = 'assigned')
    into v_deliveries, v_collections
    from public.order_status_events e
   where e.order_id = p_order_id and e.to_status = 'failed';

  return v_deliveries >= coalesce(v_max_d, 3)
      or v_collections >= coalesce(v_max_c, 3);
end $$;

comment on function public.order_attempts_exhausted is
  'TRUE once EITHER ceiling is spent. The single place the two are compared, so '
  'close_trip cannot disagree with the shop panel about whether a parcel is '
  'still being retried.';


-- ----------------------------------------------------------------------------
-- 4. resolve_failed_order — resolvable either way, returnable only if collected
-- ----------------------------------------------------------------------------

create or replace function public.resolve_failed_order(
  p_order_id   uuid,
  p_resolution text,
  p_note       text default null
) returns public.orders
language plpgsql security definer
set search_path = public
as $$
declare
  v_o           public.orders;
  v_attempts    integer;
  v_uncollected integer;
  v_note     text := nullif(trim(coalesce(p_note, '')), '');
begin
  if p_resolution not in ('retry','return','cancel') then
    raise exception 'bad_resolution: %', p_resolution using errcode = '22023';
  end if;

  select * into v_o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  -- Definer functions bypass RLS, so the policy test is restated here.
  if not (public.owns_shop(v_o.shop_id) or public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Only a parcel that has actually failed can be resolved. Note this covers a
  -- parcel that failed and was then AUTO-RETRIED back to `pending` by
  -- close_trip: it is the useful moment to say "stop, bring it back", and its
  -- status alone no longer shows that anything went wrong.
  -- Any failure at all, of either kind: a parcel the rider could not COLLECT is
  -- just as resolvable as one that failed at the customer's door.
  v_attempts   := public.order_attempt_count(p_order_id);
  v_uncollected := public.order_uncollected_count(p_order_id);
  if v_attempts + v_uncollected = 0 then
    raise exception 'order_never_failed' using errcode = '55000',
      hint = 'Cancel a pending parcel instead; there is nothing to resolve.';
  end if;

  -- A parcel we never collected is ALREADY at the shop. Sending a rider to
  -- carry it back would dispatch them to fetch nothing, and the return leg
  -- would end with a receiver signing for a parcel that never left.
  if p_resolution = 'return' and v_attempts = 0 then
    raise exception 'order_never_collected' using errcode = '55000',
      hint = 'This parcel is still at the shop -- there is nothing to return. '
             'Try again, or cancel it.';
  end if;
  if v_o.status in ('delivered','cancelled') then
    raise exception 'order_closed: %', v_o.status using errcode = '55000';
  end if;
  -- A parcel a rider is physically carrying is not the shop's to redirect.
  if v_o.status in ('assigned','picked_up') then
    raise exception 'order_in_flight: %', v_o.status using errcode = '55000',
      hint = 'It is out with a rider again. Wait for this attempt to finish.';
  end if;

  update public.orders set
      resolution      = p_resolution,
      resolution_note = v_note,
      resolved_at     = now(),
      resolved_by     = auth.uid(),
      -- 'retry'  : back into the pool. fail_reason is cleared because the next
      --            attempt starts clean, exactly as assign_order does it.
      -- 'cancel' : terminal. The status machine stamps closed_at.
      -- 'return' : status is NOT touched. The parcel stays where it is and the
      --            resolution is what removes it from the delivery pool; 0012
      --            gives it a real `returned` status once it can actually travel.
      status          = case
                          when p_resolution = 'retry'  then 'pending'::public.order_status
                          when p_resolution = 'cancel' then 'cancelled'::public.order_status
                          else status
                        end,
      fail_reason     = case when p_resolution = 'retry' then null else fail_reason end,
      cancel_reason   = case
                          when p_resolution = 'cancel'
                          then coalesce(v_note, 'Cancelled by the shop after a failed delivery')
                          else cancel_reason
                        end
   where id = p_order_id
   returning * into v_o;

  -- The decision joins the contact log (0017). orders.resolution_note holds only
  -- the CURRENT decision and is overwritten if the parcel is resolved twice; the
  -- log is the history, and it is where the office reads the whole story of a
  -- parcel in one column.
  insert into public.order_notes (order_id, author_id, author_role, kind, body)
  values (p_order_id, auth.uid(), public.auth_role(), 'decision',
          case p_resolution
            when 'retry'  then 'Decision: try again.'
            when 'return' then 'Decision: return to the shop.'
            else 'Decision: cancel the order.'
          end || coalesce(' ' || v_note, ''));

  perform public.write_audit('order.resolve_failed', 'orders', p_order_id::text,
    jsonb_build_object('status', v_o.status, 'attempts', v_attempts,
                       'uncollected', v_uncollected),
    jsonb_build_object('resolution', p_resolution, 'note', v_note));

  return v_o;
end $$;

-- ----------------------------------------------------------------------------
-- 5. close_trip — asks order_attempts_exhausted instead of counting
--
--  Unchanged from 0013 apart from the two release branches.
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
-- 6. GRANTS
-- ----------------------------------------------------------------------------

grant execute on function
  public.order_uncollected_count(uuid),
  public.order_attempts_exhausted(uuid)
to authenticated;

revoke execute on function
  public.order_uncollected_count(uuid),
  public.order_attempts_exhausted(uuid)
from anon;
