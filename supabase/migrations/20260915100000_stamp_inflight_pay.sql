-- ============================================================================
-- 0043. THE PARCELS THAT DEPARTED BEFORE THEIR PAY EXISTED
--
-- A one-time repair of a window, not a schema change.
--
-- 0042 taught `load_trip` to stamp `rider_commission_pct`,
-- `rider_commission_amount` and `platform_fee_amount` onto every parcel it
-- puts on a `per_parcel` route's delivery leg. That stamp is what makes
-- `tg_orders_audit` book a `commission_earned` line the moment the rider taps
-- Done, which is what makes "earned today" move while they work.
--
-- But a run that was loaded and DEPARTED before 0042 was applied went out with
-- those three columns NULL, and nothing downstream will ever fill them in:
--
--   * `load_trip` only stamps at load time, and these parcels are already
--     loaded and already aboard a departed run.
--   * `tg_orders_audit` guards its commission line on
--     `coalesce(new.rider_commission_amount, 0) > 0`, so a NULL books nothing.
--   * `close_trip` on a `per_parcel` route books NO `trip_pay` line -- that is
--     the whole point of the branch; the parcels are supposed to have paid
--     themselves.
--
-- So the rider collects the cash, delivers every parcel, and earns ZERO. Both
-- halves of their pay fall through the gap between the two models. On this
-- project that was 8 parcels carrying 62,000 Ks of COD.
--
-- ----------------------------------------------------------------------------
-- WHY THE SCOPE IS THIS NARROW
--
-- Stamping a parcel on a 'trip'-model route would DOUBLE-PAY: `close_trip`
-- still books that route's single `trip_pay` line, and the delivery trigger
-- would now book a per-parcel commission beside it. The `pay_model =
-- 'per_parcel'` and `trip_leg = 'delivery'` filters are therefore not tidiness,
-- they are the correctness condition. They are exactly the conditions 0042's
-- `load_trip` branches on, and the arithmetic below is character-for-character
-- the expression `assign_order` has always used
-- (`20260825090900_retire_offer_engine.sql:107-122`), including the per-rider
-- override and the platform taking the remainder so
-- `orders_commission_split_sane` holds exactly.
--
-- Terminal parcels are excluded. A delivered one cannot be repaired this way --
-- its ledger edge has already passed, so stamping it now would change a
-- historical figure without booking the money. There were none here; if there
-- ever are, they need a deliberate ledger line, not this.
--
-- IDEMPOTENT, by `rider_commission_amount is null`. Re-running finds nothing,
-- which also makes it a no-op on any fresh database -- migrations run before
-- `seed.sql`, so there is nothing in flight when this executes.
--
-- NOT A PRICING CHANGE. This stamps whatever `app_settings.rider_commission_pct`
-- says AT THE MOMENT IT RUNS, for the reason 0001 gives about snapshots:
-- repricing next month must not silently restate what a rider earned today.
-- ============================================================================

do $$
declare v_rows bigint;
begin
  update public.orders o
     set rider_commission_pct    = x.pct,
         rider_commission_amount = floor(o.delivery_fee * x.pct / 100.0)::bigint,
         platform_fee_amount     = o.delivery_fee
                                   - floor(o.delivery_fee * x.pct / 100.0)::bigint
    from public.trips t
    join public.routes r on r.id = t.route_id
    cross join lateral (
      select coalesce(rp.commission_pct_override, s.rider_commission_pct) as pct
        from public.app_settings s
        left join public.rider_profiles rp on rp.id = t.rider_id
       where s.id
    ) x
   where o.trip_id  = t.id
     and r.pay_model = 'per_parcel'
     and o.trip_leg  = 'delivery'
     and t.rider_id is not null
     and o.rider_commission_amount is null
     and o.delivery_fee > 0            -- cod_ledger_nonzero: a waived fee books
                                       -- no line, so leave it NULL rather than
                                       -- stamping a zero the trigger will skip
     and o.status not in ('delivered', 'cancelled', 'returned');

  get diagnostics v_rows = row_count;
  raise notice '0043: stamped pay onto % in-flight parcel(s)', v_rows;
end $$;
