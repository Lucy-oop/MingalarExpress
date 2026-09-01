-- ============================================================================
--  MINGALAR EXPRESS  ·  0008 — TRIP RPCs, DEPART OVERRIDE, TRIP PAY
--
--  0007 gave routes, trips and pay tiers a shape. This file gives them a life:
--
--      plan_trip → assign_trip_rider → load_trip → depart_trip
--                → return_trip → close_trip
--
--  Three things in here are load-bearing and easy to get wrong later.
--
--  1. THE 20-PARCEL RULE IS A DEPARTURE GATE, NOT A LOADING ONE.
--     A trip is under 20 parcels for almost the whole of loading — that is what
--     loading IS. Blocking there would fight the operator all morning. The one
--     moment the number is a decision rather than a work-in-progress is when the
--     bike leaves, so depart_trip() is where it is checked, and it is an
--     OVERRIDE, not a wall: dispatch may send a short run, but must say why, and
--     the reason lands in audit_log. Same philosophy as the COD float override.
--
--  2. TRIP PAY IS SNAPSHOTTED ON CLOSE, exactly like the commission split is
--     snapshotted at assignment (ARCHITECTURE D5). Repricing the tiers next
--     month must not rewrite last month's settlements, so close_trip() writes
--     the numbers AND the tier it used onto the trip row, then books one
--     immutable ledger line.
--
--  3. FIVE AGGREGATES HAD TO LEARN ABOUT 'trip_pay'. Until 0007 every kyat the
--     platform owed a rider arrived as 'commission_earned', and five places sum
--     that kind by name. A route rider earns nothing under that kind, so leaving
--     any one of them alone silently under-reports rider earnings — including in
--     build_settlement, i.e. in what the rider is actually paid. §8 fixes all
--     five together.
--
--  Forward-only. The offer engine is retired in 0009.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. SCHEMA — what departure and pay need to record
--
--  These belong to 0007's tables but ship here because they exist only to serve
--  the functions below, and the repo is forward-only: 0007 may already have been
--  applied somewhere by the time this lands.
-- ----------------------------------------------------------------------------

-- The operational minimum is a SETTING, not a constant, for the same reason the
-- pay tiers are rows: the source spec contradicted itself about volume, and ops
-- must be able to correct the number without a migration. lib/pricing.ts mirrors
-- the default as MIN_PARCELS_PER_TRIP and pricing.test.ts asserts the two agree.
alter table public.app_settings
  add column if not exists min_parcels_per_trip smallint not null default 20
    check (min_parcels_per_trip between 0 and 500);

comment on column public.app_settings.min_parcels_per_trip is
  'Parcels a run should carry before it is worth sending out. Enforced by '
  'depart_trip() as an overridable gate, not a hard block. Distinct from '
  'break-even (about 5-7 parcels): a 14-parcel run makes money but still fails '
  'this rule.';

alter table public.trips
  add column if not exists departed_by           uuid references public.profiles(id) on delete set null,
  -- Kept even though parcel_count is snapshotted on close: parcels can be
  -- unloaded after departure (a mis-load found on the road), and the audit
  -- question is "how many were on the bike when it left", which nothing else
  -- would then be able to answer.
  add column if not exists depart_parcel_count   integer,
  add column if not exists depart_override_reason text;

alter table public.trips
  drop constraint if exists trips_depart_override_sane;
alter table public.trips
  add constraint trips_depart_override_sane check (
    depart_override_reason is null or length(trim(depart_override_reason)) >= 10
  );

comment on column public.trips.depart_override_reason is
  'Non-null only when the run departed under app_settings.min_parcels_per_trip. '
  'Also written to audit_log by depart_trip(). NULL is the normal case.';

-- Trip pay is the first ledger line in this schema with no order behind it, so
-- the ledger needs its own way back to what produced it. Without this,
-- build_settlement cannot find the delivery fees a route run earned: a PREPAID
-- route order books no ledger line at all (commission columns stay NULL, no COD
-- to collect), so it would be invisible to the fee total and platform_share
-- would come out wrong.
alter table public.cod_ledger
  add column if not exists trip_id uuid references public.trips(id) on delete set null;

create index if not exists cod_ledger_trip_idx on public.cod_ledger (trip_id)
  where trip_id is not null;

-- Idempotency backstop, mirroring cod_ledger_order_kind_uk from 0002: a trip
-- books its pay exactly once, however close_trip() is retried.
create unique index if not exists cod_ledger_trip_pay_uk on public.cod_ledger (trip_id)
  where kind = 'trip_pay';

comment on column public.cod_ledger.trip_id is
  'Set on the single trip_pay line a run books on close, and on nothing else. '
  'order_id is NULL on that line -- the pay is for the run, not for one parcel.';


-- ----------------------------------------------------------------------------
-- 2. quote_trip_pay — the pure pricing function
--
--  base(parcel count) + (parcels × route_parcel_rate) + (pickups × route_pickup_rate)
--
--  STABLE and side-effect free so the planning board can preview the exact
--  number close_trip() will book. lib/pricing.ts quoteTripPay() is the twin;
--  pricing.test.ts pins the boundaries that were ambiguous in the spec.
--
--  Tier resolution mirrors pickPayTier(): among the tiers whose range covers the
--  parcel count, a row naming THIS route wins over a global row. That ordering
--  is the whole reason route_pay_tiers.route_id exists.
-- ----------------------------------------------------------------------------

create or replace function public.quote_trip_pay(
  p_parcels  integer,
  p_pickups  integer default 0,
  p_route_id uuid    default null
) returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_p      integer := greatest(coalesce(p_parcels, 0), 0);
  v_u      integer := greatest(coalesce(p_pickups, 0), 0);
  v_tier   public.route_pay_tiers;
  v_prate  bigint;
  v_urate  bigint;
  v_base   bigint;
  v_parcel bigint;
  v_pickup bigint;
begin
  select s.route_parcel_rate, s.route_pickup_rate
    into v_prate, v_urate
    from public.app_settings s where s.id;

  select t.* into v_tier
    from public.route_pay_tiers t
   where v_p >= t.min_parcels
     and (t.max_parcels is null or v_p <= t.max_parcels)
     and (t.route_id = p_route_id or t.route_id is null)
   -- route-specific first, then the narrowest covering global range
   order by (t.route_id is not null) desc, t.min_parcels desc
   limit 1;

  -- No covering tier is not an error: base pay is simply zero and the run still
  -- earns its per-parcel money. Failing here would make close_trip() unable to
  -- finish a run because of a gap in a pricing table.
  v_base   := coalesce(v_tier.base_pay, 0);
  v_parcel := v_p::bigint * coalesce(v_prate, 0);
  v_pickup := v_u::bigint * coalesce(v_urate, 0);

  return jsonb_build_object(
    'parcels',     v_p,
    'pickups',     v_u,
    'parcel_rate', coalesce(v_prate, 0),
    'pickup_rate', coalesce(v_urate, 0),
    'tier',        case when v_tier.id is null then null else jsonb_build_object(
                     'id',          v_tier.id,
                     'route_id',    v_tier.route_id,
                     'min_parcels', v_tier.min_parcels,
                     'max_parcels', v_tier.max_parcels,
                     'base_pay',    v_tier.base_pay
                   ) end,
    'base_pay',    v_base,
    'parcel_pay',  v_parcel,
    'pickup_pay',  v_pickup,
    'total',       v_base + v_parcel + v_pickup
  );
end $$;

comment on function public.quote_trip_pay is
  'Trip pay preview and the exact arithmetic close_trip() books. Twin of '
  'quoteTripPay() in lib/pricing.ts.';


-- ----------------------------------------------------------------------------
-- 3. route_for_area — the default Way for a township
-- ----------------------------------------------------------------------------

create or replace function public.route_for_area(p_area_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select ra.route_id
    from public.route_areas ra
    join public.routes r on r.id = ra.route_id
   where ra.area_id = p_area_id and ra.is_primary and r.is_active
   limit 1
$$;

comment on function public.route_for_area is
  'The primary route serving a service area, or NULL if none. A township may sit '
  'on several routes; exactly one of them is primary (route_areas_primary_uk).';


-- ----------------------------------------------------------------------------
-- 4. plan_trip / assign_trip_rider
-- ----------------------------------------------------------------------------

create or replace function public.plan_trip(
  p_route_id     uuid,
  p_service_date date default null,
  p_rider_id     uuid default null
) returns public.trips
language plpgsql security definer
set search_path = public
as $$
declare
  v_t    public.trips;
  v_date date := coalesce(p_service_date, public.mm_today());
  v_r    public.routes;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_r from public.routes where id = p_route_id;
  if not found then
    raise exception 'route_not_found' using errcode = 'P0002';
  end if;
  if not v_r.is_active then
    raise exception 'route_inactive: %', v_r.code using errcode = '55000';
  end if;

  insert into public.trips (route_id, rider_id, service_date, status, created_by)
  values (p_route_id, p_rider_id, v_date, 'planned', auth.uid())
  returning * into v_t;

  perform public.write_audit('trip.plan', 'trips', v_t.id::text, null, to_jsonb(v_t));
  return v_t;
end $$;


--  Separate from plan_trip because the manifest is often built before anyone
--  knows who rides. Cascades onto orders already attached: an order cannot sit
--  at status 'assigned' with a NULL rider (orders_assigned_needs_rider), so the
--  two have to move together or not at all.
create or replace function public.assign_trip_rider(
  p_trip_id  uuid,
  p_rider_id uuid
) returns public.trips
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.trips;
  v_r public.rider_profiles;
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

  -- Bring the already-loaded parcels along.
  update public.orders
     set rider_id    = p_rider_id,
         status      = 'assigned',
         assigned_at = coalesce(assigned_at, now()),
         assigned_by = auth.uid(),
         cod_status  = case when payment_method = 'cod' then 'pending'::public.cod_status
                            else 'none'::public.cod_status end
   where trip_id = p_trip_id
     and status in ('pending','failed');

  perform public.write_audit('trip.assign_rider', 'trips', v_t.id::text,
                             jsonb_build_object('rider_id', null),
                             jsonb_build_object('rider_id', p_rider_id));
  return v_t;
end $$;


-- ----------------------------------------------------------------------------
-- 5. load_trip / unload_trip
--
--  load_trip is where the per-trip COD ceiling is checked. The running per-rider
--  float block from 0002 cannot work here — one run holds ~1,000,000 Ks and
--  would trip it immediately — so the limit moved to the one moment anyone can
--  still act on it: before the parcels go on the bike.
--
--  Trip-attached orders are deliberately NOT counted in
--  rider_profiles.active_order_count. See 0007 §10: the trip is the capacity
--  unit, and tg_orders_audit's release is guarded on old.trip_id being NULL, so
--  incrementing here would leave the counter permanently high.
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
  v_parcels   integer;
  v_cod       bigint;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_leg not in ('delivery','pickup') then
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

  -- Every id must be loadable, or none are: a partial load leaves the dispatcher
  -- believing parcels are on the bike that are not.
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

  -- Ceilings are checked against the trip AFTER this load, not just this batch.
  select
      count(*) filter (where coalesce(o.trip_leg, 'delivery') = 'delivery'),
      coalesce(sum(o.cod_amount), 0)
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

  -- delivery_fee is NOT rewritten here. The shop was quoted when the order was
  -- created; repricing a parcel because a dispatcher put it on a different run
  -- would change a number the shop has already been shown.
  --
  -- rider_commission_* stay NULL on purpose. That is what makes tg_orders_audit
  -- skip the commission line for these orders (0007 §10) so pay arrives once per
  -- run instead of once per parcel.
  update public.orders o
     set trip_id     = p_trip_id,
         trip_leg    = p_leg,
         rider_id    = coalesce(v_t.rider_id, o.rider_id),
         status      = case when v_t.rider_id is not null then 'assigned'::public.order_status
                            else o.status end,
         assigned_at = case when v_t.rider_id is not null then coalesce(o.assigned_at, now()) end,
         assigned_by = case when v_t.rider_id is not null then auth.uid() end,
         cod_status  = case when v_t.rider_id is not null and o.payment_method = 'cod'
                            then 'pending'::public.cod_status else o.cod_status end,
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


create or replace function public.unload_trip(
  p_trip_id   uuid,
  p_order_ids uuid[]
) returns public.trips
language plpgsql security definer
set search_path = public
as $$
declare
  v_t   public.trips;
  v_ids uuid[] := coalesce(p_order_ids, '{}'::uuid[]);
  v_n   integer;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_t from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;
  if v_t.status in ('closed','cancelled') then
    raise exception 'trip_closed: %', v_t.status using errcode = '55000';
  end if;

  -- Only parcels still in hand come off. A delivered or failed parcel stays
  -- attached, because close_trip() pays on it and the ledger already refers to
  -- it. Detaching it would silently reduce the rider's pay for work done.
  update public.orders
     set trip_id  = null,
         trip_leg = null,
         status   = 'pending'
   where trip_id = p_trip_id
     and id = any(v_ids)
     and status in ('pending','assigned');
  get diagnostics v_n = row_count;

  perform public.write_audit('trip.unload', 'trips', p_trip_id::text, null,
    jsonb_build_object('order_ids', to_jsonb(v_ids), 'unloaded', v_n));

  select * into v_t from public.trips where id = p_trip_id;
  return v_t;
end $$;


-- ----------------------------------------------------------------------------
-- 6. depart_trip — THE 20-PARCEL GATE
--
--  Checked here and nowhere else. During loading the count is meaningless (it
--  starts at zero); at departure it is a decision. So this is a gate, and an
--  overridable one:
--
--    parcels >= minimum            → departs, nothing recorded
--    parcels <  minimum, no reason → refused, 55000, hint naming the override
--    parcels <  minimum, + reason  → departs, reason stored on the trip AND
--                                    written to audit_log
--
--  The record goes to audit_log, not to cod_ledger. A short run moves no money
--  at the moment it departs — it changes what the run is WORTH, which shows up
--  later in the trip_pay line close_trip() books. Putting a note in a
--  double-entry ledger with no amount would corrupt the one table whose sum has
--  to mean something.
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
      count(*) filter (where o.trip_leg = 'delivery'),
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

comment on function public.depart_trip is
  'Sends a run out. Refuses a run under app_settings.min_parcels_per_trip unless '
  'an override_reason of 10+ characters is given, in which case the run departs '
  'and the reason, the shortfall and the projected margin are written to '
  'audit_log as trip.depart_below_minimum.';


-- ----------------------------------------------------------------------------
-- 7. return_trip / close_trip / cancel_trip
-- ----------------------------------------------------------------------------

create or replace function public.return_trip(p_trip_id uuid)
returns public.trips
language plpgsql security definer
set search_path = public
as $$
declare v_t public.trips;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.trips set status = 'returned', returned_at = now()
   where id = p_trip_id and status = 'departed'
  returning * into v_t;

  if not found then
    raise exception 'trip_not_returnable' using errcode = '55000',
      hint = 'Only a departed trip can return.';
  end if;

  perform public.write_audit('trip.return', 'trips', v_t.id::text, null, null);
  return v_t;
end $$;


--  close_trip is the pay event. It is terminal and it is the only writer of
--  'trip_pay', because cod_ledger is append-only: a correction is a new
--  'adjustment' line, never a re-close.
--
--  WHAT COUNTS AS PAID WORK — the one judgement call in this file:
--
--    parcels : delivery-leg orders that reached 'delivered' OR 'failed'. The
--              rider rode to the address either way, and paying only on success
--              would make a refused delivery the rider's loss.
--    pickups : pickup-leg orders actually collected ('picked_up' / 'delivered').
--              A pickup that was not there is not work.
--
--  Cancelled parcels are excluded from both. If the business wants pay on LOADED
--  rather than COMPLETED parcels, change these two filters — not the tiers.
create or replace function public.close_trip(p_trip_id uuid)
returns public.trips
language plpgsql security definer
set search_path = public
as $$
declare
  v_t       public.trips;
  v_r       public.routes;
  v_parcels integer;
  v_pickups integer;
  v_open    integer;
  v_q       jsonb;
  v_total   bigint;
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

  perform public.write_audit('trip.close', 'trips', v_t.id::text, null, to_jsonb(v_t));
  return v_t;
end $$;


create or replace function public.cancel_trip(p_trip_id uuid, p_reason text)
returns public.trips
language plpgsql security definer
set search_path = public
as $$
declare v_t public.trips;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_t from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;
  if v_t.status = 'closed' then
    raise exception 'trip_already_closed' using errcode = '55000';
  end if;

  -- Parcels go back to the unrouted pool rather than being cancelled with the
  -- trip: the customer is still waiting, only the run is off.
  update public.orders
     set trip_id = null, trip_leg = null, status = 'pending'
   where trip_id = p_trip_id and status in ('pending','assigned');

  update public.trips
     set status = 'cancelled',
         notes  = coalesce(notes || E'\n', '') || coalesce(p_reason, '')
   where id = p_trip_id
  returning * into v_t;

  perform public.write_audit('trip.cancel', 'trips', v_t.id::text, null,
                             jsonb_build_object('reason', p_reason));
  return v_t;
end $$;


-- ----------------------------------------------------------------------------
-- 8. AGGREGATES THAT MUST LEARN ABOUT 'trip_pay'
--
--  Five places summed 'commission_earned' by name because until now it was the
--  only kind that meant "the platform owes the rider". A route rider earns
--  nothing under that kind. Every one of these is re-created below; missing any
--  single one under-reports rider earnings, and in build_settlement's case that
--  means under-PAYING a rider.
-- ----------------------------------------------------------------------------

-- 8a. build_settlement — the one that actually moves money.
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
        coalesce(-sum(l.amount) filter (where l.kind in ('commission_earned','trip_pay')), 0)::bigint
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


-- 8b. rider_earnings_summary — what the rider app shows.
create or replace function public.rider_earnings_summary(p_rider_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public
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
      -- CHANGED: both kinds. A route rider earning only trip_pay saw 0 here.
      'earned_today',     coalesce((select -sum(l.amount) from public.cod_ledger l
                                    where l.rider_id = v_rider
                                      and l.kind in ('commission_earned','trip_pay')
                                      and l.created_at >= public.mm_day_start(v_today)), 0),
      'earned_week',      coalesce((select -sum(l.amount) from public.cod_ledger l
                                    where l.rider_id = v_rider
                                      and l.kind in ('commission_earned','trip_pay')
                                      and l.created_at >= public.mm_day_start(v_today - 6)), 0),
      'trip_pay_today',   coalesce((select -sum(l.amount) from public.cod_ledger l
                                    where l.rider_id = v_rider and l.kind = 'trip_pay'
                                      and l.created_at >= public.mm_day_start(v_today)), 0),
      'delivered_today',  coalesce((select count(*) from public.orders o
                                    where o.rider_id = v_rider and o.status = 'delivered'
                                      and o.delivered_at >= public.mm_day_start(v_today)), 0),
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


-- 8c. cod_positions — the audit explorer's rider view.
--     trip_pay gets its OWN column rather than being folded into `commission`:
--     the two are different pay models and an auditor comparing a rider against
--     the fee schedule needs to know which one they are looking at. The signature
--     changes, so this is a drop-and-create, not a replace.
drop function if exists public.cod_positions();

create or replace function public.cod_positions()
returns table (
  rider_id        uuid,
  full_name       text,
  phone           text,
  base_area       text,
  is_active       boolean,
  cod_collected   bigint,
  cod_remitted    bigint,
  commission      bigint,
  trip_pay        bigint,
  adjustments     bigint,
  open_balance    bigint,
  settled_total   bigint,
  cod_float_limit bigint,
  open_since      timestamptz,
  last_entry_at   timestamptz,
  entry_count     bigint
)
language sql stable security invoker
set search_path = public
as $$
  select
    r.id,
    p.full_name,
    p.phone,
    a.name,
    p.is_active,
    coalesce(sum(l.amount) filter (where l.kind = 'cod_collected'), 0)::bigint,
    coalesce(-sum(l.amount) filter (where l.kind = 'cod_remitted'), 0)::bigint,
    coalesce(-sum(l.amount) filter (where l.kind = 'commission_earned'), 0)::bigint,
    coalesce(-sum(l.amount) filter (where l.kind = 'trip_pay'), 0)::bigint,
    coalesce(sum(l.amount) filter (where l.kind in ('adjustment','platform_fee')), 0)::bigint,
    coalesce(sum(l.amount) filter (where l.settlement_id is null), 0)::bigint,
    coalesce(sum(l.amount) filter (where l.settlement_id is not null), 0)::bigint,
    r.cod_float_limit,
    min(l.created_at) filter (where l.settlement_id is null),
    max(l.created_at),
    count(l.id)
  from public.rider_profiles r
  join public.profiles p on p.id = r.id
  left join public.service_areas a on a.id = r.base_area_id
  left join public.cod_ledger l on l.rider_id = r.id
  group by r.id, p.full_name, p.phone, a.name, p.is_active, r.cod_float_limit
  order by coalesce(sum(l.amount) filter (where l.settlement_id is null), 0) desc,
           p.full_name;
$$;


-- 8d. admin_overview — Super Admin KPIs. Additive: jsonb, so new keys are free.
create or replace function public.admin_overview()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_today date := public.mm_today();
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'riders_total',      (select count(*) from public.rider_profiles),
    'riders_online',     (select count(*) from public.rider_profiles where is_online),
    'riders_inactive',   (select count(*) from public.rider_profiles r
                           join public.profiles p on p.id = r.id where not p.is_active),
    'shops_total',       (select count(*) from public.shops),
    'shops_inactive',    (select count(*) from public.shops where not is_active),
    'areas_total',       (select count(*) from public.service_areas where is_active),
    'orders_today',      (select count(*) from public.orders
                           where created_at >= public.mm_day_start(v_today)),
    'delivered_today',   (select count(*) from public.orders
                           where status = 'delivered' and delivered_at >= public.mm_day_start(v_today)),
    'pending_now',       (select count(*) from public.orders where status = 'pending'),
    'unrouted_now',      (select count(*) from public.orders
                           where status = 'pending' and trip_id is null),
    'in_flight_now',     (select count(*) from public.orders
                           where status in ('assigned','picked_up')),
    'cod_outstanding',   (select coalesce(sum(amount), 0) from public.cod_ledger
                           where settlement_id is null),
    'fees_today',        (select coalesce(sum(delivery_fee), 0) from public.orders
                           where status = 'delivered' and delivered_at >= public.mm_day_start(v_today)),
    -- CHANGED: both kinds, or a route-only day reports zero rider cost and the
    -- dashboard shows a margin that does not exist.
    'rider_earnings_today', (select coalesce(-sum(amount), 0) from public.cod_ledger
                              where kind in ('commission_earned','trip_pay')
                                and created_at >= public.mm_day_start(v_today)),
    'trip_pay_today',    (select coalesce(-sum(amount), 0) from public.cod_ledger
                           where kind = 'trip_pay'
                             and created_at >= public.mm_day_start(v_today)),
    'trips_today',       (select count(*) from public.trips where service_date = v_today),
    'trips_open',        (select count(*) from public.trips
                           where status in ('planned','loading','departed')),
    -- Runs that went out short. The point of the override is that somebody can
    -- see how often it is being used.
    'trips_short_today', (select count(*) from public.trips
                           where service_date = v_today
                             and depart_override_reason is not null),
    'settlements_open',  (select count(*) from public.settlements where status = 'submitted'),
    'settlements_unpaid',(select count(*) from public.settlements where status = 'approved'),
    'riders_over_float', (select count(*) from public.rider_profiles r
                           where public.rider_cod_in_hand(r.id) >= r.cod_float_limit
                             and r.cod_float_limit > 0)
  );
end $$;


-- ----------------------------------------------------------------------------
-- 9. GRANTS
--     RLS and the in-function role guards are the boundary; these are the
--     privileges they filter. anon gets nothing.
-- ----------------------------------------------------------------------------

grant execute on function
  public.quote_trip_pay(integer, integer, uuid),
  public.route_for_area(uuid),
  public.plan_trip(uuid, date, uuid),
  public.assign_trip_rider(uuid, uuid),
  public.load_trip(uuid, uuid[], text),
  public.unload_trip(uuid, uuid[]),
  public.depart_trip(uuid, text),
  public.return_trip(uuid),
  public.close_trip(uuid),
  public.cancel_trip(uuid, text),
  public.cod_positions()
to authenticated;

revoke execute on function
  public.quote_trip_pay(integer, integer, uuid),
  public.route_for_area(uuid),
  public.plan_trip(uuid, date, uuid),
  public.assign_trip_rider(uuid, uuid),
  public.load_trip(uuid, uuid[], text),
  public.unload_trip(uuid, uuid[]),
  public.depart_trip(uuid, text),
  public.return_trip(uuid),
  public.close_trip(uuid),
  public.cancel_trip(uuid, text),
  public.cod_positions()
from anon;
