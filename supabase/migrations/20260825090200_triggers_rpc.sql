-- ============================================================================
--  MINGALAR EXPRESS  ·  0002 — HELPERS, TRIGGERS, STATE MACHINE, RPCs
-- ============================================================================

set check_function_bodies = off;

-- ----------------------------------------------------------------------------
-- 1. ROLE RESOLUTION
--    SECURITY DEFINER so RLS policies can read profiles without recursing into
--    profiles' own policy. search_path is pinned on every definer function --
--    an unpinned definer function is a privilege-escalation vector.
--
--    NOTE: this is auth_role(), not current_role(). CURRENT_ROLE is a reserved
--    SQL keyword and cannot be safely used as a function name.
-- ----------------------------------------------------------------------------

create or replace function public.auth_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$
  select p.role from public.profiles p
   where p.id = auth.uid() and p.is_active
$$;

create or replace function public.is_admin()
returns boolean language sql stable set search_path = public
as $$ select public.auth_role() = 'super_admin' $$;

create or replace function public.is_dispatch()
returns boolean language sql stable set search_path = public
as $$ select public.auth_role() in ('super_admin','dispatcher') $$;

create or replace function public.is_rider()
returns boolean language sql stable set search_path = public
as $$ select public.auth_role() = 'rider' $$;

-- TRUE when there is no end-user JWT on the request: a service-role call, a
-- psql/SQL-editor session, pg_cron, or the seed. Such contexts are already
-- trusted (service_role carries BYPASSRLS; `postgres` owns every table), so the
-- privilege guards below must not block them -- otherwise the Admin API cannot
-- register a rider and nightly settlement cron cannot run.
-- Safe because `anon` also has a null uid but holds no table grants and is
-- matched by no policy that could reach these code paths.
create or replace function public.is_service_ctx()
returns boolean language sql stable set search_path = public
as $$ select auth.uid() is null $$;

create or replace function public.owns_shop(p_shop_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.shops s
     where s.id = p_shop_id and s.owner_id = auth.uid()
  )
$$;

-- Riders may read a shop only while they hold live work for it. Definer, so the
-- shops policy does not have to nest an RLS-filtered read of orders.
create or replace function public.rider_has_work_at_shop(p_shop_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.orders o
     where o.shop_id = p_shop_id
       and o.rider_id = auth.uid()
       and o.status in ('assigned','picked_up')
  )
$$;

-- Live unsettled cash position of a rider, in MMK.
create or replace function public.rider_cod_in_hand(p_rider_id uuid)
returns bigint language sql stable security definer set search_path = public
as $$
  select coalesce(sum(l.amount), 0)::bigint
    from public.cod_ledger l
   where l.rider_id = p_rider_id and l.settlement_id is null
$$;

revoke execute on function
  public.auth_role(), public.is_admin(), public.is_dispatch(), public.is_rider(),
  public.is_service_ctx(),
  public.owns_shop(uuid), public.rider_has_work_at_shop(uuid),
  public.rider_cod_in_hand(uuid)
from anon;


-- ----------------------------------------------------------------------------
-- 2. AUDIT WRITER
-- ----------------------------------------------------------------------------

create or replace function public.write_audit(
  p_action text, p_table text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null
) returns void
language sql security definer set search_path = public
as $$
  insert into public.audit_log (actor_id, actor_role, action, entity_table, entity_id, before, after)
  values (auth.uid(), public.auth_role(), p_action, p_table, p_entity_id, p_before, p_after)
$$;


-- ----------------------------------------------------------------------------
-- 3. PRIVILEGE GUARDS
-- ----------------------------------------------------------------------------

-- profiles: nobody escalates their own role or reactivates themselves.
create or replace function public.tg_profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_service_ctx() then return new; end if;
  if not public.is_admin() then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'role_change_forbidden'
        using errcode = '42501',
              hint = 'Only super_admin may change profiles.role or profiles.is_active.';
    end if;
  elsif new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    perform public.write_audit('profile.privilege_change', 'profiles', old.id::text,
      jsonb_build_object('role', old.role, 'is_active', old.is_active),
      jsonb_build_object('role', new.role, 'is_active', new.is_active));
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
for each row execute function public.tg_profiles_guard();

-- rider_profiles: a rider owns their presence, not their pay or their capacity.
-- Column-level REVOKE cannot be used here -- column privileges apply to every
-- `authenticated` user and would lock out Super Admins too.
create or replace function public.tg_riders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Internal bookkeeping (assign_order, tg_orders_audit) sets this tx-local flag.
  if coalesce(current_setting('app.rider_guard_bypass', true), 'off') = 'on' then
    return new;
  end if;
  if public.is_admin() or public.is_service_ctx() then return new; end if;

  if new.base_area_id            is distinct from old.base_area_id
  or new.commission_pct_override is distinct from old.commission_pct_override
  or new.max_active_orders       is distinct from old.max_active_orders
  or new.cod_float_limit         is distinct from old.cod_float_limit
  or new.active_order_count      is distinct from old.active_order_count
  or new.nrc_no                  is distinct from old.nrc_no then
    raise exception 'rider_field_admin_only'
      using errcode = '42501',
            hint = 'base_area_id, commission, capacity, float limit and NRC are super_admin-only.';
  end if;

  -- A rider may narrow their own radius, never widen it.
  if new.coverage_km > old.coverage_km then
    raise exception 'coverage_increase_admin_only' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger riders_guard before update on public.rider_profiles
for each row execute function public.tg_riders_guard();

-- app_settings: audit every pricing change; only admins pass RLS to get here.
create or replace function public.tg_settings_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.write_audit('settings.update', 'app_settings', 'singleton',
                             to_jsonb(old), to_jsonb(new));
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger app_settings_audit before update on public.app_settings
for each row execute function public.tg_settings_audit();


-- ----------------------------------------------------------------------------
-- 4. ORDER STATE MACHINE  (BEFORE UPDATE)
--
--     pending   -> assigned | cancelled
--     assigned  -> picked_up | failed | pending(unassign) | cancelled
--     picked_up -> delivered | failed
--     failed    -> assigned | pending | cancelled
--     delivered -> (terminal)
--     cancelled -> (terminal)
--
--  Timestamps and cod_status are derived here, never trusted from the client.
-- ----------------------------------------------------------------------------

create or replace function public.tg_orders_status_machine()
returns trigger language plpgsql set search_path = public as $$
declare v_ok boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  v_ok := case old.status
            when 'pending'   then new.status in ('assigned','cancelled')
            when 'assigned'  then new.status in ('picked_up','failed','pending','cancelled')
            when 'picked_up' then new.status in ('delivered','failed')
            when 'failed'    then new.status in ('assigned','pending','cancelled')
            else false                       -- delivered / cancelled are terminal
          end;

  if not v_ok then
    raise exception 'illegal_transition: % -> %', old.status, new.status
      using errcode = '55000';
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

    when 'cancelled', 'failed' then
      new.closed_at := now();

    else null;
  end case;

  return new;
end $$;

create trigger orders_status_machine before update on public.orders
for each row execute function public.tg_orders_status_machine();

create trigger orders_touch before update on public.orders
for each row execute function public.tg_touch_updated_at();


-- ----------------------------------------------------------------------------
-- 5. ORDER AUDIT + CAPACITY + LEDGER  (AFTER INSERT/UPDATE)
--
--  Rider geo for the checkpoint row travels via tx-local settings so that
--  advance_order() does not have to insert an event itself (which would double
--  up with this trigger).
-- ----------------------------------------------------------------------------

-- Idempotency backstop: one cod_collected and one commission_earned per order,
-- no matter how the row is manipulated.
create unique index cod_ledger_order_kind_uk on public.cod_ledger (order_id, kind)
  where kind in ('cod_collected','commission_earned');

create or replace function public.tg_orders_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lat  double precision := nullif(current_setting('app.event_lat',  true), '')::double precision;
  v_lng  double precision := nullif(current_setting('app.event_lng',  true), '')::double precision;
  v_note text            := nullif(current_setting('app.event_note', true), '');
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
  -- Covers completion, failure, cancellation, unassignment and hand-over.
  if old.rider_id is not null
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
  -- Two lines, always in this order:
  --   + cod_amount              (rider now holds the platform's cash)
  --   - rider_commission_amount (platform now owes the rider their cut)
  -- Prepaid deliveries produce only the negative line -- the rider still earns.
  if new.status = 'delivered' and old.status <> 'delivered' and new.rider_id is not null then
    if new.payment_method = 'cod' and new.cod_amount > 0 then
      insert into public.cod_ledger (order_id, rider_id, kind, amount, created_by, memo)
      values (new.id, new.rider_id, 'cod_collected', new.cod_amount,
              coalesce(auth.uid(), new.rider_id), new.code)
      on conflict do nothing;
    end if;

    if coalesce(new.rider_commission_amount, 0) > 0 then
      insert into public.cod_ledger (order_id, rider_id, kind, amount, created_by, memo)
      values (new.id, new.rider_id, 'commission_earned', -new.rider_commission_amount,
              coalesce(auth.uid(), new.rider_id), new.code)
      on conflict do nothing;
    end if;
  end if;

  return new;
end $$;

create trigger orders_audit after insert or update on public.orders
for each row execute function public.tg_orders_audit();


-- ----------------------------------------------------------------------------
-- 6. AUTH BRIDGE
--
--  Role comes from raw_app_meta_data (app_metadata), which is writable ONLY by
--  the service-role Admin API -- never by the client. raw_user_meta_data
--  (user_metadata) IS client-writable and must never be trusted for role.
--
--  IMPORTANT: GoTrue's admin createUser INSERTs the user row and only THEN
--  UPDATEs it with app_metadata. An AFTER INSERT trigger therefore sees no role
--  claim and every admin-created rider/dispatcher silently lands as the default
--  shop_owner. Verified against gotrue v2.195.0. So the role is synced on INSERT
--  *and* on UPDATE OF raw_app_meta_data, which makes app_metadata the single
--  source of truth for role -- and also gives us promotion for free.
-- ----------------------------------------------------------------------------

create or replace function public.claimed_role(p_meta jsonb)
returns public.user_role
language plpgsql immutable as $$
begin
  return coalesce((p_meta ->> 'role')::public.user_role, 'shop_owner');
exception when invalid_text_representation then
  return 'shop_owner';
end $$;

create or replace function public.tg_on_auth_user_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role public.user_role := public.claimed_role(new.raw_app_meta_data);
begin
  insert into public.profiles (id, role, full_name, phone)
  values (
    new.id,
    v_role,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(coalesce(new.email, ''), '@', 1),
      'New User'
    ),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', new.phone)), '')
  )
  on conflict (id) do nothing;

  if v_role = 'rider' then
    insert into public.rider_profiles (id, coverage_km)
    select new.id, s.default_coverage_km from public.app_settings s where s.id
    on conflict (id) do nothing;
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.tg_on_auth_user_created();

-- Catches the admin API's follow-up UPDATE, and any later promotion.
create or replace function public.tg_on_auth_user_meta_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role := public.claimed_role(new.raw_app_meta_data);
  v_had  boolean := (new.raw_app_meta_data ? 'role');
begin
  -- Only act when a role was actually claimed; absence must not demote anyone
  -- back to the shop_owner default.
  if not v_had then return new; end if;

  update public.profiles p
     set role = v_role,
         full_name = coalesce(
           nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), p.full_name),
         phone = coalesce(
           p.phone, nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', new.phone)), ''))
   where p.id = new.id
     and (p.role <> v_role
          or p.full_name <> coalesce(
               nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), p.full_name)
          or p.phone is null);

  if v_role = 'rider' then
    insert into public.rider_profiles (id, coverage_km)
    select new.id, s.default_coverage_km from public.app_settings s where s.id
    on conflict (id) do nothing;
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_meta_changed on auth.users;
create trigger on_auth_user_meta_changed
after update of raw_app_meta_data, raw_user_meta_data on auth.users
for each row execute function public.tg_on_auth_user_meta_changed();


-- ============================================================================
--  7. RPC 1/5 — nearby_available_riders
--
--  The core hyper-local matching query. Index-accelerated: the partial GiST
--  index riders_dispatch_gix is the only thing scanned. ST_DWithin does the
--  radius filter, `<->` orders by true distance.
--
--  Deliberately does NOT filter on COD headroom. It returns cod_in_hand and
--  cod_float_limit so the dispatcher UI can show the rider as blocked but still
--  allow a deliberate override. Hard-filtering here would hide riders from a
--  human who may have just taken cash off them.
--
--  SECURITY INVOKER: RLS applies, so only dispatch/admin can see rider rows.
-- ============================================================================

create or replace function public.nearby_available_riders(
  p_order_id uuid,
  p_limit    integer default 10,
  p_max_km   numeric default null
)
returns table (
  rider_id        uuid,
  full_name       text,
  phone           text,
  base_area       text,
  base_area_id    uuid,
  distance_km     numeric,
  active_orders   smallint,
  max_active      smallint,
  coverage_km     numeric,
  cod_in_hand     bigint,
  cod_float_limit bigint,
  vehicle_plate   text,
  last_ping_at    timestamptz
)
language sql stable security invoker
set search_path = public, extensions
as $$
  with o as (
    select pickup_geog, cod_amount, payment_method
      from public.orders where id = p_order_id
  ),
  cfg as (
    select rider_ping_stale_min from public.app_settings where id
  )
  select
    r.id,
    p.full_name,
    p.phone,
    a.name,
    r.base_area_id,
    round((extensions.st_distance(r.current_geog, o.pickup_geog) / 1000.0)::numeric, 2),
    r.active_order_count,
    r.max_active_orders,
    r.coverage_km,
    coalesce((select sum(l.amount) from public.cod_ledger l
               where l.rider_id = r.id and l.settlement_id is null), 0)::bigint,
    r.cod_float_limit,
    r.vehicle_plate,
    r.last_ping_at
  from public.rider_profiles r
  cross join o
  cross join cfg
  join public.profiles p on p.id = r.id and p.is_active
  left join public.service_areas a on a.id = r.base_area_id
  where r.is_online
    and r.availability = 'available'
    and r.current_geog is not null
    and r.last_ping_at > now() - make_interval(mins => cfg.rider_ping_stale_min)
    and r.active_order_count < r.max_active_orders
    and extensions.st_dwithin(
          r.current_geog,
          o.pickup_geog,
          least(coalesce(p_max_km, r.coverage_km), r.coverage_km) * 1000.0
        )
  order by r.current_geog <-> o.pickup_geog
  limit greatest(coalesce(p_limit, 10), 1);
$$;

comment on function public.nearby_available_riders is
  'Ranked candidate riders for an order pickup point. Filtering is done here '
  '(PostGIS, indexed); weighted scoring is done in lib/geo/dispatch.ts.';


-- ============================================================================
--  8. RPC 2/5 — assign_order
--
--  Row-locked. Two dispatchers clicking the same rider is a real race in a
--  live dispatch room; SELECT ... FOR UPDATE is what makes exactly one win.
--  Snapshots the commission split onto the order (see ARCHITECTURE.md D5).
-- ============================================================================

create or replace function public.assign_order(
  p_order_id uuid,
  p_rider_id uuid
) returns public.orders
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_o      public.orders;
  v_r      public.rider_profiles;
  v_pct    numeric(5,2);
  v_com    bigint;
  v_dist   numeric(6,2);
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Lock order first, then rider: a fixed lock order prevents deadlock between
  -- two concurrent assignments touching the same pair in opposite order.
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if v_o.status not in ('pending','failed') then
    raise exception 'order_not_assignable: %', v_o.status using errcode = '55000';
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
    into v_pct
    from public.app_settings s where s.id;

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

  insert into public.order_assignments
    (order_id, rider_id, response, offered_by, offered_at, responded_at, distance_km)
  values
    (p_order_id, p_rider_id, 'accepted', auth.uid(), now(), now(), v_dist)
  on conflict (order_id, rider_id) do update
    set response = 'accepted', responded_at = now(), distance_km = excluded.distance_km;

  return v_o;
end $$;


-- ============================================================================
--  9. RPC 3/5 — advance_order   (rider checkpoint transitions)
--
--  Proof-gated. The rider's GPS fix rides along in tx-local settings and is
--  picked up by tg_orders_audit, so exactly one checkpoint row is written.
-- ============================================================================

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
  if p_to not in ('picked_up','delivered','failed') then
    raise exception 'advance_order handles picked_up | delivered | failed only'
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

  if p_to = 'failed' and coalesce(nullif(trim(p_reason), ''), v_o.fail_reason) is null then
    raise exception 'fail_reason_required' using errcode = '55000';
  end if;

  -- Hand the geo fix to tg_orders_audit.
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


-- ============================================================================
--  10. RPC 4/5 — rider_heartbeat
--
--  Called every ~20s from the PWA. Single-row write, no triggers of consequence.
--  NOT bypassing tg_riders_guard: presence and location are exactly what a
--  rider is allowed to change about themselves, so it passes on its merits.
-- ============================================================================

create or replace function public.rider_heartbeat(
  p_lat    double precision default null,
  p_lng    double precision default null,
  p_online boolean default true
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not (public.is_rider() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.rider_profiles
     set is_online    = p_online,
         current_lat  = case when p_lat is not null and p_lng is not null then p_lat  else current_lat end,
         current_lng  = case when p_lat is not null and p_lng is not null then p_lng  else current_lng end,
         last_ping_at = now()
   where id = auth.uid();

  if not found then
    raise exception 'rider_profile_missing' using errcode = 'P0002';
  end if;
end $$;


-- ============================================================================
--  11. RPC 5/5 — build_settlement
--
--  Aggregates from the LEDGER, not from orders -- the ledger is the book of
--  record. Idempotent: re-running for the same (rider, date) re-claims any new
--  unsettled rows and recomputes totals over the whole claimed set.
--  Refuses to touch an already approved or paid settlement.
-- ============================================================================

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
  -- is_service_ctx() so pg_cron can draft settlements nightly without a JWT.
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

  -- Claim every still-unsettled line booked before end-of-day Yangon time.
  -- Stragglers from earlier unsettled days are swept in deliberately.
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
        coalesce(sum(l.amount) filter (where l.kind = 'cod_collected'), 0)::bigint      as gross_cod,
        coalesce(-sum(l.amount) filter (where l.kind = 'commission_earned'), 0)::bigint as rider_earnings,
        coalesce(sum(l.amount), 0)::bigint                                              as net_due,
        coalesce((select sum(o.delivery_fee)
                    from public.orders o
                   where o.id in (select distinct l2.order_id
                                    from public.cod_ledger l2
                                   where l2.settlement_id = v_s.id
                                     and l2.order_id is not null)), 0)::bigint          as delivery_fees,
        count(distinct l.order_id)                                                      as order_count
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


-- ============================================================================
--  12. PUBLIC TRACKING RPC  (anon)
--
--  /track/[code] needs a checkpoint timeline without exposing the customer's
--  phone, exact address or the rider's identity. anon has no table grants, so
--  this definer function is its only door in.
-- ============================================================================

create or replace function public.track_order(p_code text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'code',        o.code,
    'status',      o.status,
    'shop_name',   sh.name,
    'dropoff_area', da.name,
    'is_cod',      (o.payment_method = 'cod'),
    'created_at',  o.created_at,
    'picked_up_at',o.picked_up_at,
    'delivered_at',o.delivered_at,
    'timeline',    coalesce((
      select jsonb_agg(jsonb_build_object('status', e.to_status, 'at', e.created_at)
                       order by e.created_at)
        from public.order_status_events e where e.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  join public.shops sh on sh.id = o.shop_id
  left join public.service_areas da on da.id = o.dropoff_area_id
  where upper(o.code) = upper(trim(p_code))
$$;

grant execute on function public.track_order(text) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 13. RPC EXECUTE GRANTS
-- ----------------------------------------------------------------------------

grant execute on function
  public.nearby_available_riders(uuid, integer, numeric),
  public.assign_order(uuid, uuid),
  public.advance_order(uuid, public.order_status, double precision, double precision, text, text, text),
  public.rider_heartbeat(double precision, double precision, boolean),
  public.build_settlement(uuid, date)
to authenticated;

revoke execute on function
  public.nearby_available_riders(uuid, integer, numeric),
  public.assign_order(uuid, uuid),
  public.advance_order(uuid, public.order_status, double precision, double precision, text, text, text),
  public.rider_heartbeat(double precision, double precision, boolean),
  public.build_settlement(uuid, date),
  public.write_audit(text, text, text, jsonb, jsonb)
from anon;
