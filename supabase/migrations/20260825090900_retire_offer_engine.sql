-- ============================================================================
--  MINGALAR EXPRESS  ·  0009 — RETIRE THE OFFER ENGINE
--
--  0005 built real-time offer/accept: a dispatcher fanned a parcel out to the
--  nearest riders and the first to tap ACCEPT won it. That is the right shape for
--  ad-hoc township work with a human watching a map.
--
--  The route model replaced the question it answered. Work is no longer "who is
--  nearest to this parcel" but "which of today's four runs does this parcel
--  belong on, and who is riding it". A parcel is loaded onto a trip at the hub;
--  there is nothing to offer and nobody to race.
--
--  WHAT GOES
--    offer_order              fan a parcel out to N riders
--    respond_to_offer         rider accepts / rejects
--    expire_stale_offers      sweep lapsed offers
--    nearby_available_riders  the PostGIS proximity search behind the ranking
--    assign_order_internal    the shared core, now with one caller
--
--  WHAT STAYS, AND WHY
--    assign_order        Route Local still needs a direct per-parcel assignment,
--                        and its SELECT ... FOR UPDATE on the order and then the
--                        rider is what stops two dispatchers sending two riders
--                        to one parcel (README rule 7). Its body is INLINED here
--                        rather than left delegating: with the offer path gone
--                        `assign_order_internal` had exactly one caller, and a
--                        SECURITY DEFINER function that exists only to be wrapped
--                        is attack surface for no benefit.
--    order_assignments   Kept as HISTORY. Every assignment ever made is in it,
--                        including the offers that were accepted last month, and
--                        that record has to outlive the engine that produced it.
--                        Client writes are revoked; only assign_order (definer,
--                        runs as owner) still appends.
--    advance_order       Untouched. The status machine, proof-of-delivery and the
--                        COD ledger are the same on a route as they ever were.
--    offer_response      The enum stays: order_assignments.response is typed by
--                        it and historic rows carry 'pending' / 'rejected' /
--                        'expired'. ALTER TYPE cannot remove a value anyway.
--
--  Forward-only. The TypeScript that called these RPCs goes in the same commit —
--  `lib/geo/dispatch.ts` (rankRiders) and the offer half of the rider feed.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. assign_order — self-contained again
--
--  Body is 0005's assign_order_internal plus 0005's wrapper, in one function.
--  Behaviour is deliberately IDENTICAL: same fixed lock order (order, then
--  rider), same commission snapshot, same capacity increment, same audit row.
--  The only thing removed is the sweep of rival pending offers, because there
--  can no longer be any.
--
--  NOTE the capacity increment stays. This is the per-parcel path, where
--  active_order_count IS the right limit; trip-attached parcels are excluded from
--  it by tg_orders_audit (0007 §10) because there the TRIP is the capacity unit.
-- ----------------------------------------------------------------------------

create or replace function public.assign_order(
  p_order_id uuid,
  p_rider_id uuid
) returns public.orders
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_o    public.orders;
  v_r    public.rider_profiles;
  v_pct  numeric(5,2);
  v_com  bigint;
  v_dist numeric(6,2);
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Fixed lock order (order, then rider) prevents deadlock between two
  -- concurrent assignments touching the same pair from opposite directions.
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if v_o.status not in ('pending','failed') then
    raise exception 'order_not_assignable: %', v_o.status using errcode = '55000';
  end if;
  -- New guard: a parcel already on a run is the trip's, and load_trip/unload_trip
  -- own it. Assigning it per-parcel here would take a capacity slot the trip
  -- release path will never give back.
  if v_o.trip_id is not null then
    raise exception 'order_on_trip' using errcode = '55000',
      hint = 'Unload it from the run first, or assign the rider to the trip.';
  end if;

  select * into v_r from public.rider_profiles where id = p_rider_id for update;
  if not found then
    raise exception 'rider_not_found' using errcode = 'P0002';
  end if;
  if not v_r.is_online or v_r.availability <> 'available'
     or v_r.active_order_count >= v_r.max_active_orders then
    raise exception 'rider_unavailable' using errcode = '55000';
  end if;

  select coalesce(v_r.commission_pct_override, s.rider_commission_pct)
    into v_pct from public.app_settings s where s.id;

  v_com  := floor(v_o.delivery_fee * v_pct / 100.0)::bigint;
  v_dist := case when v_r.current_geog is null then null
                 else round((extensions.st_distance(v_r.current_geog, v_o.pickup_geog) / 1000.0)::numeric, 2)
            end;

  update public.orders set
      rider_id                = p_rider_id,
      status                  = 'assigned',
      assigned_at             = now(),
      assigned_by             = auth.uid(),
      assign_distance_km      = v_dist,
      route_distance_km       = round((extensions.st_distance(pickup_geog, dropoff_geog) / 1000.0)::numeric, 2),
      rider_commission_pct    = v_pct,
      rider_commission_amount = v_com,
      platform_fee_amount     = v_o.delivery_fee - v_com,
      cod_status              = case when v_o.payment_method = 'cod'
                                     then 'pending'::public.cod_status
                                     else 'none'::public.cod_status end,
      fail_reason             = null
   where id = p_order_id
   returning * into v_o;

  perform set_config('app.rider_guard_bypass', 'on', true);
  update public.rider_profiles
     set active_order_count = active_order_count + 1,
         availability = case when active_order_count + 1 >= max_active_orders
                            then 'busy'::public.rider_availability
                            else 'available'::public.rider_availability end
   where id = p_rider_id;
  perform set_config('app.rider_guard_bypass', 'off', true);

  -- History row. order_assignments is now append-only audit, so this is the last
  -- writer it has.
  insert into public.order_assignments
    (order_id, rider_id, response, offered_by, offered_at, responded_at, distance_km)
  values (p_order_id, p_rider_id, 'accepted', auth.uid(), now(), now(), v_dist)
  on conflict (order_id, rider_id) do update
    set response = 'accepted', responded_at = now(), distance_km = excluded.distance_km;

  return v_o;
end $$;

comment on function public.assign_order is
  'Direct per-parcel assignment, row-locked. The remaining non-trip path (Route '
  'Local ad-hoc drops, reassigning a failed parcel). Refuses a parcel already '
  'attached to a trip — that belongs to load_trip/unload_trip.';


-- ----------------------------------------------------------------------------
-- 2. DROP THE OFFER ENGINE
--
--  Order matters: assign_order above no longer references assign_order_internal,
--  so the core can go. Dropping a function other functions still call would fail
--  here rather than at runtime, which is the behaviour we want.
-- ----------------------------------------------------------------------------

drop function if exists public.respond_to_offer(uuid, boolean);
drop function if exists public.offer_order(uuid, uuid[], integer);
drop function if exists public.expire_stale_offers();
drop function if exists public.nearby_available_riders(uuid, integer, numeric);
drop function if exists public.assign_order_internal(uuid, uuid);


-- ----------------------------------------------------------------------------
-- 3. order_assignments — history, not a work queue
--
--  The offer policies described a live negotiation: a rider updating their own
--  pending row, a dispatcher inserting fan-out rows. Neither can happen now, and
--  a policy that permits an action nothing performs is a hole waiting for a bug
--  to find it. Read access is unchanged so the audit trail stays visible.
-- ----------------------------------------------------------------------------

drop policy if exists oa_respond_rider  on public.order_assignments;
drop policy if exists oa_write_dispatch on public.order_assignments;

-- Same treatment as cod_ledger in 0003: no policy AND no privilege, so an
-- attempt fails at the grant layer rather than silently matching zero rows.
revoke insert, update, delete on public.order_assignments from authenticated;

comment on table public.order_assignments is
  'APPEND-ONLY HISTORY of who was offered or given each parcel, including the '
  'offer/accept era retired in 0009. Written only by assign_order (SECURITY '
  'DEFINER, runs as the owner). No client role may write it.';


-- ----------------------------------------------------------------------------
-- 4. orders_read_rider — drop the offer branch
--
--  A rider could see a parcel that was merely OFFERED to them. With offers gone
--  the subquery can never be true, and leaving it would keep a join against a
--  table nothing writes in the hot read path of the rider app.
--
--  Trip parcels need no new branch: load_trip and assign_trip_rider set
--  orders.rider_id, so the run's manifest is already covered by the first term.
-- ----------------------------------------------------------------------------

drop policy if exists orders_read_rider on public.orders;

create policy orders_read_rider on public.orders
  for select to authenticated
  using (rider_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 5. DISPATCHER ACCESS FOR THE ROUTE MODEL
--
--  Planning, loading and departing a run all go through the 0008 RPCs, which are
--  SECURITY DEFINER and gate on is_dispatch() themselves. What RLS has to allow
--  is the BOARD: the reads that render it, and the writes a dispatcher makes
--  directly rather than through an RPC.
--
--  Already correct from 0007: trips_read_own_or_dispatch, trips_write_dispatch,
--  orders_all_dispatch, routes_read_all, route_areas_read_all. Verified by
--  route_flow.sql R8.
--
--  What changes: route_areas writes were super_admin-only. Re-ordering stops
--  along a run is a dispatcher's job — `stop_order` is the rider's manifest
--  sequence — so dispatch gets write access to the mapping table.
--
--  `routes` and `route_pay_tiers` stay ADMIN-ONLY on purpose. Those are the fee
--  schedule and the rider pay tiers; a dispatcher who could edit them could
--  reprice a run they are about to dispatch.
-- ----------------------------------------------------------------------------

drop policy if exists route_areas_write_admin on public.route_areas;

create policy route_areas_write_dispatch on public.route_areas
  for all to authenticated
  using (public.is_dispatch()) with check (public.is_dispatch());

comment on table public.route_areas is
  'Which areas a route serves, in stop order. Readable by every authenticated '
  'user, writable by dispatch (stop_order is operational). Fees and pay tiers '
  'are NOT here precisely so dispatch can reorder stops without touching money.';


-- ----------------------------------------------------------------------------
-- 6. REALTIME — follow the work
--
--  order_assignments was published so a rider's phone lit up the moment a job
--  was offered. Nothing inserts into it from a client any more, so publishing it
--  is WAL traffic for an event that cannot occur.
--
--  `trips` takes its place: the dispatcher board and the rider's manifest both
--  need to know the moment a run changes state (loaded, departed, closed).
--  Low volume — a handful of rows a day per route — which is exactly what
--  postgres_changes is good at.
-- ----------------------------------------------------------------------------

alter table public.trips replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename = 'order_assignments'
    ) then
      execute 'alter publication supabase_realtime drop table public.order_assignments';
    end if;

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trips'
    ) then
      execute 'alter publication supabase_realtime add table public.trips';
    end if;
  else
    raise notice 'publication supabase_realtime not found — skipping (expected on bare Postgres)';
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 7. SETTINGS THE OFFER ENGINE OWNED
--
--  offer_ttl_seconds is now dead: nothing reads it. The COLUMN is kept rather
--  than dropped because the admin pricing form posts the whole settings row and
--  a dropped column there is a 400 on save, not a tidy-up. It is marked so the
--  next person does not wire a new feature to it, and the pricing UI now edits
--  min_parcels_per_trip in its place.
--
--  rider_ping_stale_min and default_coverage_km stay LIVE: presence freshness
--  still drives the rider-online indicator, and coverage_km is still a rider
--  profile field the admin panel edits.
-- ----------------------------------------------------------------------------

comment on column public.app_settings.offer_ttl_seconds is
  'DEPRECATED in 0009 with the offer engine. Nothing reads it. Kept so the '
  'settings form keeps round-tripping; do not build on it.';


-- ----------------------------------------------------------------------------
-- 8. GRANT HYGIENE
--     The dropped functions took their grants with them; this is the remaining
--     surface, restated so it is checkable in one place.
-- ----------------------------------------------------------------------------

grant execute on function public.assign_order(uuid, uuid) to authenticated;
revoke execute on function public.assign_order(uuid, uuid) from anon;
