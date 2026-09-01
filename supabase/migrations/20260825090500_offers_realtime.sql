-- ============================================================================
--  MINGALAR EXPRESS  ·  0005 — OFFER / ACCEPT FLOW + REALTIME
--
--  Phase 3 shipped direct assignment: the dispatcher picks a rider and
--  `assign_order` puts the parcel on them. That is the right default for a
--  township-sized fleet with a human dispatcher watching the board.
--
--  Phase 4 needs the other half: the rider app has to be able to ACCEPT work.
--  `order_assignments` was built for that in 0001 but nothing wrote to it except
--  `assign_order` (which records an already-accepted row for audit). This
--  migration adds the two RPCs that make offers real, and refactors the
--  assignment core so both paths share exactly one implementation of "lock the
--  order, lock the rider, snapshot the commission, take capacity".
--
--  Two paths in, one lock discipline:
--      dispatcher --> assign_order      --\
--                                          >-- assign_order_internal
--      rider      --> respond_to_offer  --/
-- ============================================================================

set check_function_bodies = off;

-- ----------------------------------------------------------------------------
-- 1. THE ASSIGNMENT CORE
--
--  No permission check inside -- callers own that. Locked down so it can only
--  ever be reached through one of the two wrappers below, both of which do check.
-- ----------------------------------------------------------------------------

create or replace function public.assign_order_internal(
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
  -- Fixed lock order (order, then rider) prevents deadlock between two
  -- concurrent assignments touching the same pair from opposite directions.
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

  return v_o;
end $$;

-- Reachable only from the definer wrappers (which run as the owner).
revoke all on function public.assign_order_internal(uuid, uuid) from public;
revoke all on function public.assign_order_internal(uuid, uuid) from anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. DISPATCHER PATH — assign_order now delegates
-- ----------------------------------------------------------------------------

create or replace function public.assign_order(
  p_order_id uuid,
  p_rider_id uuid
) returns public.orders
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_o public.orders; v_dist numeric(6,2);
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_o := public.assign_order_internal(p_order_id, p_rider_id);
  v_dist := v_o.assign_distance_km;

  -- Audit row: a direct assignment is an offer that was never in doubt.
  insert into public.order_assignments
    (order_id, rider_id, response, offered_by, offered_at, responded_at, distance_km)
  values (p_order_id, p_rider_id, 'accepted', auth.uid(), now(), now(), v_dist)
  on conflict (order_id, rider_id) do update
    set response = 'accepted', responded_at = now(), distance_km = excluded.distance_km;

  -- Any other live offer on this order is now moot.
  update public.order_assignments
     set response = 'expired', responded_at = now()
   where order_id = p_order_id and rider_id <> p_rider_id and response = 'pending';

  return v_o;
end $$;


-- ----------------------------------------------------------------------------
-- 3. offer_order — put a job in front of N riders without committing it
--
--  The order stays `pending` on purpose. If every offer expires unanswered it is
--  still in the dispatcher's queue, ageing visibly, rather than sitting in a
--  half-assigned state nobody is watching.
-- ----------------------------------------------------------------------------

create or replace function public.offer_order(
  p_order_id   uuid,
  p_rider_ids  uuid[],
  p_ttl_seconds integer default null
) returns setof public.order_assignments
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_o   public.orders;
  v_ttl integer;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_rider_ids is null or array_length(p_rider_ids, 1) is null then
    raise exception 'no_riders_supplied' using errcode = '22023';
  end if;

  select * into v_o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if v_o.status not in ('pending','failed') then
    raise exception 'order_not_assignable: %', v_o.status using errcode = '55000';
  end if;

  select coalesce(p_ttl_seconds, s.offer_ttl_seconds) into v_ttl
    from public.app_settings s where s.id;

  return query
  insert into public.order_assignments
    (order_id, rider_id, rank, distance_km, response, offered_by, offered_at, expires_at)
  select
    p_order_id,
    r.id,
    row_number() over (order by extensions.st_distance(r.current_geog, v_o.pickup_geog))::smallint,
    case when r.current_geog is null then null
         else round((extensions.st_distance(r.current_geog, v_o.pickup_geog) / 1000.0)::numeric, 2)
    end,
    'pending',
    auth.uid(),
    now(),
    now() + make_interval(secs => v_ttl)
  from public.rider_profiles r
  where r.id = any(p_rider_ids)
  on conflict (order_id, rider_id) do update
    set response    = 'pending',
        offered_by  = excluded.offered_by,
        offered_at  = now(),
        expires_at  = excluded.expires_at,
        responded_at = null,
        rank        = excluded.rank,
        distance_km = excluded.distance_km
  returning *;
end $$;


-- ----------------------------------------------------------------------------
-- 4. respond_to_offer — the rider's Accept / Decline
--
--  Accepting races exactly like a dispatcher assignment does, because it goes
--  through the same locking core. Two riders accepting the same offer: one gets
--  the parcel, the other gets `order_not_assignable`.
-- ----------------------------------------------------------------------------

create or replace function public.respond_to_offer(
  p_order_id uuid,
  p_accept   boolean
) returns public.orders
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_offer public.order_assignments;
  v_o     public.orders;
begin
  select * into v_offer
    from public.order_assignments
   where order_id = p_order_id and rider_id = auth.uid()
   for update;

  if not found then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;
  if v_offer.response <> 'pending' then
    raise exception 'offer_already_answered: %', v_offer.response using errcode = '55000';
  end if;
  if v_offer.expires_at <= now() then
    update public.order_assignments
       set response = 'expired', responded_at = now()
     where id = v_offer.id;
    raise exception 'offer_expired' using errcode = '55000';
  end if;

  if not p_accept then
    update public.order_assignments
       set response = 'rejected', responded_at = now()
     where id = v_offer.id;
    select * into v_o from public.orders where id = p_order_id;
    return v_o;
  end if;

  v_o := public.assign_order_internal(p_order_id, auth.uid());

  update public.order_assignments
     set response = 'accepted', responded_at = now()
   where id = v_offer.id;

  update public.order_assignments
     set response = 'expired', responded_at = now()
   where order_id = p_order_id and id <> v_offer.id and response = 'pending';

  return v_o;
end $$;


-- ----------------------------------------------------------------------------
-- 5. expire_stale_offers — for pg_cron, and cheap enough to call on read
-- ----------------------------------------------------------------------------

create or replace function public.expire_stale_offers()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare v_count integer;
begin
  update public.order_assignments
     set response = 'expired', responded_at = now()
   where response = 'pending' and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;


-- ----------------------------------------------------------------------------
-- 6. RIDER EARNINGS SUMMARY
--
--  The rider app needs "what have I earned today" and "how much of the
--  platform's cash am I holding". Both come from the ledger, which is the book
--  of record -- never recomputed from orders.
-- ----------------------------------------------------------------------------

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
      'earned_today',     coalesce((select -sum(l.amount) from public.cod_ledger l
                                    where l.rider_id = v_rider and l.kind = 'commission_earned'
                                      and l.created_at >= public.mm_day_start(v_today)), 0),
      'earned_week',      coalesce((select -sum(l.amount) from public.cod_ledger l
                                    where l.rider_id = v_rider and l.kind = 'commission_earned'
                                      and l.created_at >= public.mm_day_start(v_today - 6)), 0),
      'delivered_today',  coalesce((select count(*) from public.orders o
                                    where o.rider_id = v_rider and o.status = 'delivered'
                                      and o.delivered_at >= public.mm_day_start(v_today)), 0),
      'active_orders',    coalesce((select count(*) from public.orders o
                                    where o.rider_id = v_rider
                                      and o.status in ('assigned','picked_up')), 0),
      'unsettled_since',  (select min(l.created_at) from public.cod_ledger l
                            where l.rider_id = v_rider and l.settlement_id is null)
    )
  );
end $$;


-- ----------------------------------------------------------------------------
-- 7. GRANTS
-- ----------------------------------------------------------------------------

grant execute on function
  public.offer_order(uuid, uuid[], integer),
  public.respond_to_offer(uuid, boolean),
  public.expire_stale_offers(),
  public.rider_earnings_summary(uuid)
to authenticated;

revoke execute on function
  public.offer_order(uuid, uuid[], integer),
  public.respond_to_offer(uuid, boolean),
  public.expire_stale_offers(),
  public.rider_earnings_summary(uuid)
from anon;


-- ----------------------------------------------------------------------------
-- 8. REALTIME
--
--  `orders` and `order_assignments` are low-volume and need RLS-filtered row
--  payloads, so postgres_changes is right for them.
--
--  rider_profiles is deliberately NOT published: a 20-second heartbeat from 40
--  riders is ~170k WAL events a day, and none of it needs durability. Rider
--  positions travel over Realtime PRESENCE instead (ephemeral, never written).
--
--  Guarded because `supabase_realtime` is created by the Supabase platform and
--  does not exist on a bare Postgres, which would break local verification.
-- ----------------------------------------------------------------------------

alter table public.orders            replica identity full;
alter table public.order_assignments replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
    ) then
      execute 'alter publication supabase_realtime add table public.orders';
    end if;

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_assignments'
    ) then
      execute 'alter publication supabase_realtime add table public.order_assignments';
    end if;
  else
    raise notice 'publication supabase_realtime not found — skipping (expected on bare Postgres)';
  end if;
end $$;
