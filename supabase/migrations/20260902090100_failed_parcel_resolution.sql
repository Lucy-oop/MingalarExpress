-- ============================================================================
--  MINGALAR EXPRESS  ·  0011 — WHAT HAPPENS TO A PARCEL THAT FAILED
--
--  Migration 0010 rescued failed parcels from being orphaned on a closed trip by
--  putting them straight back into the dispatch pool. That fixed the bug and
--  created a quieter one: **retry became automatic, silent and unbounded**. A
--  customer who was out yesterday gets tried again today, and again, and the shop
--  is never asked and never told.
--
--  This migration gives the shop the decision, and puts a ceiling on the default.
--
--    Try again    the parcel goes back into the pool
--    Return to me the parcel stops being delivered and comes home
--    Cancel       the shop gives up on it
--
--  There is deliberately no "refund". A failed COD parcel collected nothing --
--  tg_orders_audit books ledger lines only on `delivered` -- so there is no money
--  in the system to give back. What a shop actually wants is "stop trying and
--  bring me my goods", which is Return.
--
--  WHY THE STATUS ENUM IS UNTOUCHED. `resolution` is a separate axis from
--  `status`: status says where the parcel physically is, resolution says what to
--  do with it next. Keeping them apart means the status machine in 0002 needs no
--  changes at all, and a shop can say "return it" while the parcel is still
--  `pending` after an auto-retry -- a transition `pending -> failed` that the
--  machine rightly forbids. A real `returned` terminal status arrives with the
--  return LEG in 0012; until then the office carries the parcel back by hand and
--  this column is what tells them to.
--
--  NO RETURN FEE. Decided deliberately at this stage: the platform absorbs the
--  cost of a failed attempt (the rider is still paid for it by close_trip) to
--  keep friction off the shop. Revisit with volume; the column to add it to is
--  orders.delivery_fee, not this table.
--
--  Forward-only.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. The decision, recorded on the order
-- ----------------------------------------------------------------------------

alter table public.orders
  add column if not exists resolution      text
    check (resolution is null or resolution in ('retry','return','cancel')),
  add column if not exists resolution_note text,
  add column if not exists resolved_at     timestamptz,
  add column if not exists resolved_by     uuid references public.profiles(id) on delete set null;

alter table public.orders
  drop constraint if exists orders_resolution_stamped;
alter table public.orders
  -- A resolution with no timestamp is unauditable: nobody can tell whether the
  -- shop chose it or a migration backfilled it.
  add constraint orders_resolution_stamped
    check (resolution is null or resolved_at is not null);

-- The planning board's pool reads this, so it is worth an index rather than a
-- sequential scan of every order the shop has ever sent.
create index if not exists orders_resolution_idx on public.orders (resolution)
  where resolution is not null;

comment on column public.orders.resolution is
  'What to do with a parcel that failed delivery: retry | return | cancel. NULL '
  'means no decision has been made -- which for a detached `failed` parcel means '
  'it is waiting on the shop. Separate from `status` on purpose: status is where '
  'the parcel is, resolution is where it is going.';


-- ----------------------------------------------------------------------------
-- 2. The ceiling on automatic retries
-- ----------------------------------------------------------------------------

alter table public.app_settings
  add column if not exists max_delivery_attempts smallint not null default 3
    check (max_delivery_attempts between 1 and 10);

comment on column public.app_settings.max_delivery_attempts is
  'How many times close_trip() will send a failed parcel back to the pool on its '
  'own before it stops and waits for the shop. 0010 shipped this as unbounded.';


-- ----------------------------------------------------------------------------
-- 3. order_attempt_count — derived, never stored
--
--  Counting `failed` checkpoints rather than keeping a counter column: the
--  checkpoint trail is already written by tg_orders_audit for every transition
--  and cannot disagree with itself, whereas a counter has to be incremented in
--  every path that can fail a parcel and will eventually be missed in one.
--
--  SECURITY INVOKER, so RLS applies: a shop counts attempts on its own parcels
--  (`ose_read`), dispatch counts any, and a stranger gets 0 rather than an error
--  that would confirm the order exists. Inside close_trip -- a definer function
--  running as the owner -- RLS is bypassed, which is what that caller needs.
-- ----------------------------------------------------------------------------

create or replace function public.order_attempt_count(p_order_id uuid)
returns integer
language sql stable security invoker
set search_path = public
as $$
  select count(*)::integer
    from public.order_status_events e
   where e.order_id = p_order_id and e.to_status = 'failed'
$$;

comment on function public.order_attempt_count is
  'Failed delivery attempts on an order, counted from the checkpoint trail.';


-- ----------------------------------------------------------------------------
-- 4. resolve_failed_order — the shop's decision
--
--  A SECURITY DEFINER function is REQUIRED here, not a convenience.
--  `orders_update_shop` (0003) permits the owning shop to write only while
--  `status = 'pending'`, so a shop cannot touch its own FAILED parcel through
--  RLS at all. Rather than widen that policy -- which would also let a shop edit
--  a parcel a rider is holding -- the one narrow decision is exposed here and
--  re-authorised inside.
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
  v_o        public.orders;
  v_attempts integer;
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
  v_attempts := (select count(*)::integer from public.order_status_events e
                  where e.order_id = p_order_id and e.to_status = 'failed');
  if v_attempts = 0 then
    raise exception 'order_never_failed' using errcode = '55000',
      hint = 'Cancel a pending parcel instead; there is nothing to resolve.';
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

  perform public.write_audit('order.resolve_failed', 'orders', p_order_id::text,
    jsonb_build_object('status', v_o.status, 'attempts', v_attempts),
    jsonb_build_object('resolution', p_resolution, 'note', v_note));

  return v_o;
end $$;

comment on function public.resolve_failed_order is
  'The shop''s decision on a failed parcel: retry (back to the pool), return '
  '(stop delivering, bring it home) or cancel (terminal). Definer because '
  'orders_update_shop only lets a shop write while pending.';


-- ----------------------------------------------------------------------------
-- 5. close_trip — stop retrying forever
--
--  Only the release block differs from 0010. Everything else is that body
--  unchanged, kept whole so the function still reads in one piece.
--
--  The release now asks two questions before putting a parcel back:
--
--    has the shop already decided?        honour it, do not re-dispatch
--    is the parcel under the attempt cap? auto-retry, as 0010 did
--    otherwise                            hold it at `failed` for the shop
--
--  A shop can therefore decide at 3pm while the run is still out, and the 6pm
--  close does the right thing without anyone touching it again.
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

  -- Release the failures. Counted above, so the rider keeps the pay for the
  -- attempt either way; what differs is whether the parcel goes back out.
  --
  -- Assigning `status = status` is a no-op the status machine returns early on,
  -- so a held or already-resolved parcel triggers no transition at all.
  -- Counted BEFORE the release, because the release nulls `trip_id` and there is
  -- then nothing left to count them by.
  select
      count(*) filter (where o.resolution is null
                         and public.order_attempt_count(o.id) < coalesce(v_max, 3)),
      count(*) filter (where o.resolution is null
                         and public.order_attempt_count(o.id) >= coalesce(v_max, 3))
    into v_released, v_held
    from public.orders o
   where o.trip_id = p_trip_id and o.status = 'failed';

  update public.orders o
     set trip_id  = null,
         trip_leg = null,
         status   = case
                      when o.resolution is not null then o.status
                      when public.order_attempt_count(o.id) < coalesce(v_max, 3)
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

comment on function public.close_trip is
  'Closes a run and books the rider trip_pay line. A failed parcel counts toward '
  'that pay, then goes back to the pool only if the shop has not decided '
  'otherwise and it is under app_settings.max_delivery_attempts; past the cap it '
  'waits for the shop (orders.resolution).';


-- ----------------------------------------------------------------------------
-- 6. GRANTS
-- ----------------------------------------------------------------------------

grant execute on function
  public.order_attempt_count(uuid),
  public.resolve_failed_order(uuid, text, text)
to authenticated;

revoke execute on function
  public.order_attempt_count(uuid),
  public.resolve_failed_order(uuid, text, text)
from anon;
