-- ============================================================================
-- 0049. WAYS, NOT ROUTES; RUNS WITH A JOB; RECEIVING PARCEL BY PARCEL
--
-- ----------------------------------------------------------------------------
-- 1. "Route A" IS NOW "Way 1"
--
-- The office calls them ways, and so does the rider app. Only the NAMES
-- change: `routes.code` (ROUTE_A ...) is an internal key that pricing
-- constants, tests and every earlier migration's seed refer to, and nobody
-- reads it on screen -- lib/routes/ways.ts turns it into the short label.
--
--   ROUTE_A -> Way 1, ROUTE_B -> Way 2, ... by letter
--   ROUTE_LOCAL -> Local Way
--
-- Guarded on the old prefix, so a name the office has already edited is left
-- alone and re-running this is a no-op.
--
-- ----------------------------------------------------------------------------
-- 2. trips.kind
--
-- The board now shows pickup ways and delivery ways as two tables. A run with
-- parcels on it is classified by its legs; an EMPTY run has none, so without
-- this it would not know which table it was created in and would jump on the
-- next refresh. Intent only: `load_trip` does not read it, because a rider has
-- one open run (`trips_rider_open_uk`) and topping it up with the other leg is
-- legitimate.
--
-- ----------------------------------------------------------------------------
-- 3. receive_trip_parcels
--
-- `receive_trip` (0040) shelves EVERY collected parcel on the run at once.
-- The office now checks the parcels off the bike one by one, and only what was
-- actually counted should land on the shelf. A parcel left unticked stays on
-- the run -- still `picked_up`, still attached -- which is the honest record
-- of "the rider says they have it and we have not seen it".
--
-- Same banking as receive_trip, for the same reason: close_trip pays for
-- pickups still attached, so the count is added to trips.pickup_count before
-- the detach or the rider loses their collection pay.
--
-- ALL OR NOTHING over the ids given. If any of them is not a collected pickup
-- on this run (another admin shelved it a moment ago, or it was never
-- collected), nothing moves and the office is told -- a partial success would
-- leave the checklist and the shelf disagreeing with no one aware.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. names
-- ----------------------------------------------------------------------------
update public.routes
   set name = 'Way ' || (ascii(substr(code, 7, 1)) - 64)::text || substr(name, 8)
 where code ~ '^ROUTE_[A-Z]$'
   and name ~ '^Route [A-Z]\M';

update public.routes
   set name = regexp_replace(name, '^Route Local', 'Local Way')
 where code = 'ROUTE_LOCAL'
   and name like 'Route Local%';

-- ----------------------------------------------------------------------------
-- 2. trips.kind
-- ----------------------------------------------------------------------------
alter table public.trips
  add column if not exists kind text;

alter table public.trips drop constraint if exists trips_kind_known;
alter table public.trips
  add constraint trips_kind_known check (kind is null or kind in ('pickup', 'delivery'));

comment on column public.trips.kind is
  'Which board table the run was created in: pickup or delivery. Intent only, '
  'for placing an EMPTY run; a loaded run is classified by its legs, and '
  'load_trip does not read this.';

-- ----------------------------------------------------------------------------
-- 3. receive_trip_parcels
-- ----------------------------------------------------------------------------
create or replace function public.receive_trip_parcels(p_trip_id uuid, p_order_ids uuid[])
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_t      public.trips;
  v_wanted integer;
  v_n      integer;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_t from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  -- Same window as receive_trip: only a run that has left can bring parcels back.
  if v_t.status not in ('departed', 'returned') then
    raise exception 'trip_not_receivable: %', v_t.status using errcode = '55000',
      hint = 'Only a run that has left the hub can bring parcels back to it.';
  end if;

  select count(distinct x) into v_wanted from unnest(coalesce(p_order_ids, '{}')) as x;
  if v_wanted = 0 then
    raise exception 'nothing_to_receive' using errcode = '55000',
      hint = 'Tick the parcels that came off the bike.';
  end if;

  -- Lock the rows being moved, and count only the ones that qualify.
  select count(*) into v_n
    from (
      select o.id
        from public.orders o
       where o.id = any(p_order_ids)
         and o.trip_id = p_trip_id
         and o.trip_leg = 'pickup'
         and o.status in ('picked_up', 'delivered')
         for update
    ) q;

  if v_n <> v_wanted then
    raise exception 'parcels_not_receivable: % of %', v_wanted - v_n, v_wanted
      using errcode = '55000',
            hint = 'Some ticked parcels are not collected pickups on this run any more. '
                   'Refresh and check the list again.';
  end if;

  -- Bank first; see the header and 0040.
  update public.trips
     set pickup_count = pickup_count + v_n
   where id = p_trip_id
  returning * into v_t;

  -- Status stays `picked_up`, exactly as receive_trip leaves it: `picked_up_at`
  -- plus no trip is what "in the hub" means (0027, 0028).
  update public.orders o
     set trip_id  = null,
         trip_leg = null
   where o.id = any(p_order_ids)
     and o.trip_id = p_trip_id
     and o.trip_leg = 'pickup'
     and o.status in ('picked_up', 'delivered');

  perform public.write_audit('trip.receive', 'trips', v_t.id::text, null,
    jsonb_build_object('shelved', v_n,
                       'order_ids', to_jsonb(p_order_ids),
                       'pickup_count_after', v_t.pickup_count));

  return v_n;
end $$;

comment on function public.receive_trip_parcels is
  'Shelves the ticked collected parcels of one run, and only those, banking '
  'the count into trips.pickup_count so close_trip still pays the rider. All '
  'or nothing over the ids given. Unticked parcels stay on the run.';

grant execute on function public.receive_trip_parcels(uuid, uuid[]) to authenticated;
revoke execute on function public.receive_trip_parcels(uuid, uuid[]) from anon;
