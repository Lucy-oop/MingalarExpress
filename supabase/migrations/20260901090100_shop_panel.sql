-- ============================================================================
--  MINGALAR EXPRESS  ·  0010 — SHOP PANEL: ROUTE PRICING, FAILED-PARCEL RESCUE
--
--  0007-0009 rebuilt dispatch and rider pay around scheduled routes. The
--  shop-facing half was never updated, and two consequences of that are bugs
--  rather than gaps.
--
--  1. A FAILED PARCEL DISAPPEARS. `unload_trip` detaches only pending/assigned
--     parcels, so a `failed` one stays bound to its trip forever. The planning
--     board's pool is `trip_id is null`, and `load_trip` refuses anything with a
--     trip_id — so once the run closes, nobody can see the parcel and nobody can
--     put it on another one. The customer simply never gets it. §2 releases it
--     on close, AFTER the rider has been paid for the attempt.
--
--  2. THE SHOP IS CHARGED BY DISTANCE. `routes.per_parcel_fee` is the fee the
--     business signed off and the number `routeMargin`/`breakEvenParcels`
--     assume, but nothing ever charged it: `createOrder` quoted from
--     `haversineKm` + `app_settings`. §1 adds the column that lets an order
--     record which route priced it, so a later remap of `route_areas` cannot
--     rewrite what a shop was already charged.
--
--  §3 gives a shop the rider's name for its own parcel, which RLS otherwise
--  forbids (profiles and rider_profiles are not shop-readable).
--
--  Forward-only.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. orders.route_id — the route that priced this parcel
--
--  A SNAPSHOT, for the same reason rider_commission_pct is a snapshot
--  (ARCHITECTURE D5). The route is otherwise only derivable through
--  `route_areas`, which dispatch may re-map at any time; deriving it later would
--  silently change the answer to "what was this shop charged, and why".
--
--  Nullable because every order created before this migration has no route, and
--  because `assign_order`'s per-parcel path never involves one.
-- ----------------------------------------------------------------------------

alter table public.orders
  add column if not exists route_id uuid references public.routes(id) on delete set null;

create index if not exists orders_route_idx on public.orders (route_id)
  where route_id is not null;

comment on column public.orders.route_id is
  'The route whose per_parcel_fee produced delivery_fee, snapshotted at '
  'creation. NOT the route the parcel actually travelled on -- that is '
  'trips.route_id via trip_id, and a dispatcher may load a parcel onto any run '
  'that serves its area.';


-- ----------------------------------------------------------------------------
-- 2. close_trip — release failed parcels back to the unrouted pool
--
--  Only §"release" is new; the rest is 0008's body, kept whole so the function
--  reads in one piece.
--
--  ORDER MATTERS. The release happens AFTER the counts are taken, so a failed
--  parcel still counts toward the rider's pay: they rode to the address, and
--  paying only on success would make a refused delivery the rider's loss. It
--  then detaches, so the planning board can offer it again tomorrow.
--
--  History is not lost by detaching: the attempt is in order_status_events with
--  its actor and GPS fix, and the closing snapshot is in audit_log.
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

  -- No delivery-leg parcel may still be in flight. Closing with parcels
  -- unaccounted for would book pay for a run that is not over.
  select count(*) into v_open
    from public.orders o
   where o.trip_id = p_trip_id
     and o.trip_leg = 'delivery'
     and o.status in ('pending','assigned','picked_up');
  if v_open > 0 then
    raise exception 'trip_has_open_orders: %', v_open using errcode = '55000',
      hint = 'Every parcel must be delivered, failed or cancelled before close.';
  end if;

  select
      count(*) filter (where o.trip_leg = 'delivery' and o.status in ('delivered','failed')),
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

  -- NEW IN 0010 — release the failures.
  --
  -- Counted above, so the rider keeps the pay; detached here, so the parcel is
  -- routable again. `rider_id` is cleared by the status machine's `pending`
  -- branch, and tg_orders_audit's capacity release is guarded on
  -- `old.trip_id is null` -- which is still true at that moment -- so the
  -- counter is not driven negative.
  update public.orders
     set trip_id  = null,
         trip_leg = null,
         status   = 'pending'
   where trip_id = p_trip_id
     and status  = 'failed';
  get diagnostics v_released = row_count;

  -- Negative: the platform owes the rider. Same sign convention as
  -- 'commission_earned' (see the comment on type ledger_kind in 0001).
  -- Skipped at zero, because cod_ledger_nonzero forbids a 0 line -- an empty run
  -- earns nothing and there is nothing to book.
  if v_total > 0 then
    insert into public.cod_ledger (order_id, trip_id, rider_id, kind, amount, created_by, memo)
    values (null, p_trip_id, v_t.rider_id, 'trip_pay', -v_total,
            coalesce(auth.uid(), v_t.rider_id),
            v_r.code || ' ' || to_char(v_t.service_date, 'YYYY-MM-DD')
              || ' · ' || v_parcels || 'p/' || v_pickups || 'u')
    on conflict do nothing;
  end if;

  perform public.write_audit('trip.close', 'trips', v_t.id::text, null,
    to_jsonb(v_t) || jsonb_build_object('released_for_retry', v_released));
  return v_t;
end $$;

comment on function public.close_trip is
  'Closes a run and books the rider trip_pay line. Failed parcels count toward '
  'that pay and are then released back to the unrouted pool so they can be '
  'redelivered -- before 0010 they stayed attached and became invisible.';


-- ----------------------------------------------------------------------------
-- 3. order_rider_card — who is carrying my parcel
--
--  A shop can read `orders.rider_id` but not `profiles` or `rider_profiles`, so
--  today it gets a bare UUID. This hands back the minimum a shop needs to chase
--  a delivery.
--
--  DELIBERATELY NOT the rider's phone. A shop calling riders directly routes
--  around dispatch, and the rider did not agree to give their number to every
--  shop they carry for. Chasing goes through the office.
-- ----------------------------------------------------------------------------

create or replace function public.order_rider_card(p_order_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_o public.orders;
  v_j jsonb;
begin
  select * into v_o from public.orders where id = p_order_id;
  if not found then
    return null;
  end if;

  -- Same test the orders policies apply, restated because a definer function
  -- bypasses RLS and must therefore re-authorise for itself.
  if not (public.owns_shop(v_o.shop_id)
          or v_o.rider_id = auth.uid()
          or public.is_dispatch()
          or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_o.rider_id is null then
    return null;
  end if;

  select jsonb_build_object(
           'rider_id',      r.id,
           'full_name',     p.full_name,
           'vehicle_plate', r.vehicle_plate)
    into v_j
    from public.rider_profiles r
    join public.profiles p on p.id = r.id
   where r.id = v_o.rider_id;

  return v_j;
end $$;

comment on function public.order_rider_card is
  'Name and vehicle plate of the rider carrying an order, for the shop that '
  'sent it. Excludes the rider''s phone on purpose -- chasing a delivery goes '
  'through dispatch, not direct to the rider.';


-- ----------------------------------------------------------------------------
-- 4. GRANTS
-- ----------------------------------------------------------------------------

grant execute on function public.order_rider_card(uuid) to authenticated;
revoke execute on function public.order_rider_card(uuid) from anon;
