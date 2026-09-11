-- ============================================================================
-- 0044. THE COLLECTIONS THAT HAPPENED BEFORE PICKUP PAY EXISTED
--
-- The companion to 0043, for the other half of the day, and the last of the
-- gap left by switching a live route to `per_parcel` mid-run.
--
-- 0042 taught `tg_orders_audit` to book a `pickup_pay` line on the
-- `-> picked_up` edge of a pickup leg. A run that collected BEFORE 0042 was
-- applied booked nothing, and nothing downstream will ever fill it in:
--
--   * the trigger fires on an edge that is long past
--   * `close_trip` on a `per_parcel` route books NO `trip_pay` -- that is the
--     whole point of the branch; the parcels are meant to pay themselves
--
-- So the rider collected eight parcels, carried them to the hub, and earns
-- nothing for the morning. 4,000 Ks at the 500 Ks rate.
--
-- ----------------------------------------------------------------------------
-- WHY THIS CANNOT BE SCOPED BY `orders.trip_id`, WHICH IS THE OBVIOUS WAY
--
-- Because there is no trip_id left to scope by. `receive_trip:148` nulls it on
-- exactly these parcels -- every dispatchable pool on the board filters
-- `trip_id is null`, so a parcel on the hub shelf must look unattached. The
-- link from those eight parcels to the run that collected them is gone from
-- `orders` permanently.
--
-- `order_status_events` is what survives: append-only, written only by the
-- SECURITY DEFINER audit trigger, and carrying actor and timestamp. 0041 used
-- it to fix `picked_up_today` for precisely this reason. A collection is
-- identified here as:
--
--   a `-> picked_up` edge, by THIS run's rider, between the run's departure
--   and its return
--
-- A rider is on one run at a time, so that window is unambiguous. Verified on
-- this project before writing: all eight events carry the rider as actor and
-- fall inside the window, and there are exactly eight such events in the
-- database.
--
-- ----------------------------------------------------------------------------
-- IDEMPOTENT TWICE OVER
--
-- `not exists` skips a parcel that already has a pickup_pay line, and
-- `cod_ledger_order_kind_uk` -- widened by 0042 to cover `pickup_pay` for this
-- exact class of reason -- refuses a duplicate at the database level even if
-- the predicate were wrong. `on conflict do nothing` makes that refusal quiet.
--
-- SELF-LIMITING, so it is safe to leave in the tree. Post-0042 every collection
-- gets its line at the moment of pickup, so no future row can match the
-- `not exists`. It is a no-op on a fresh database too: migrations run before
-- `seed.sql`, so there are no orders at all when this executes.
--
-- THE RATE IS `app_settings.route_pickup_rate`, 500 both when these parcels
-- were collected and now. Pay is normally snapshotted at the moment it is
-- earned (0001); there is no snapshot to read here, so the live rate is the
-- only honest answer, and it happens to be the same one.
-- ============================================================================

do $$
declare v_rows bigint;
begin
  insert into public.cod_ledger
    (order_id, trip_id, rider_id, kind, amount, created_by, memo)
  select distinct on (e.order_id)
         e.order_id,
         t.id,
         t.rider_id,
         'pickup_pay'::public.ledger_kind,
         -- Negative: a pay line is money the platform owes the rider. See the
         -- comment on `ledger_kind`.
         -s.route_pickup_rate,
         t.rider_id,
         o.code
    from public.trips t
    join public.routes r
      on r.id = t.route_id
     and r.pay_model = 'per_parcel'
    join public.order_status_events e
      on e.to_status  = 'picked_up'
     and e.actor_id   = t.rider_id
     and e.created_at >= t.departed_at
     and e.created_at <= coalesce(t.returned_at, t.closed_at, now())
    join public.orders o
      on o.id = e.order_id
    cross join public.app_settings s
   where t.rider_id    is not null
     and t.departed_at is not null
     and s.id
     and s.route_pickup_rate > 0     -- cod_ledger_nonzero refuses a zero line
     and not exists (
       select 1
         from public.cod_ledger l
        where l.order_id = e.order_id
          and l.kind     = 'pickup_pay'
     )
   order by e.order_id, e.created_at
  on conflict do nothing;

  get diagnostics v_rows = row_count;
  raise notice '0044: booked pickup pay for % collection(s)', v_rows;
end $$;
