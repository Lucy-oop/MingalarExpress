-- ============================================================================
--  MINGALAR EXPRESS  ·  0041 — THE RIDER'S OWN NUMBERS STOP LYING
--
--  Three separate faults on one screen, reported as "company cash you are
--  holding is not working". Observed live: a rider who had collected eight
--  parcels that morning saw `earned_today 0`, `cod_in_hand 0` and
--  `picked_up_today 0`. Two of those three are bugs in here. The third is the
--  pay model and is 0042's problem.
--
--  ---------------------------------------------------------------------------
--  1. "COMPANY CASH YOU ARE HOLDING" ANSWERED A DIFFERENT QUESTION
--
--  The card asks what cash is in the rider's bag. `rider_cod_in_hand` returns
--  the NET OPEN LEDGER BALANCE -- cash collected, minus commission earned,
--  minus trip pay. Those are different numbers and on a route day they are
--  wildly different: trip pay is one large negative line, so the net goes
--  NEGATIVE while the bag is full.
--
--  Worse, the UI gates both the amber highlight and the explanation on
--  `codInHand > 0`, so at a negative value the card printed a negative number
--  under "cash you are holding" and the words "Nothing outstanding." directly
--  beneath it. Two contradictory statements about the same money.
--
--  `rider_cod_in_hand` is NOT wrong -- it is the settlement figure, it is what
--  `remit_cod` and `riders_over_float` need, and `settlement_flow` asserts it.
--  So it keeps its meaning and its name, and this adds the OTHER number:
--
--      rider_cash_held    = cod_collected + cod_remitted   (remitted is already
--                           negative, so a plain sum is the bag)
--      rider_cod_in_hand  = everything open                (what settlement nets)
--
--  ---------------------------------------------------------------------------
--  2. `picked_up_today` ERASED ITSELF WHEN THE OFFICE SORTED THE SHELF
--
--  It counted `orders.trip_leg = 'pickup'`. But `trip_leg` is CURRENT state:
--  the office receives the parcels and loads them onto a delivery run, the leg
--  flips to 'delivery', and the rider's morning disappears from their own
--  screen. Nothing recovers it -- the count simply reads zero from then on.
--
--  This is the same class of mistake 0028 fixed for `picked_up_at`: a physical
--  fact about where a parcel has been must not be stored in a column that
--  describes where it is going. The durable record is
--  `order_status_events`, which is append-only and which no reload touches.
--
--  WHO GETS THE CREDIT, and this is a judgement call. The event carries
--  `actor_id` (who tapped) and the order carries `rider_id` (whose parcel it is
--  NOW). They agree at the moment of collection and can diverge later:
--
--      reassigned for delivery   actor_id still the collector, rider_id is not
--      recorded by the office    rider_id still the collector, actor_id is not
--
--  Counting on EITHER covers both. The only false positive is a parcel
--  collected by one rider and handed to another for delivery on the same day,
--  which shows on both riders' counts -- and over-counting one collection on
--  the delivery rider's screen is a far smaller harm than erasing the
--  collector's entire morning, which is what happens today.
--
--  ---------------------------------------------------------------------------
--  3. `rider_cod_in_hand` HAD NO AUTHORIZATION CHECK
--
--  Found while reading it. Any authenticated user could call
--  `rider_cod_in_hand('<someone else''s uuid>')` and read that rider's cash
--  position: it is `security definer`, so RLS does not apply inside it, and
--  nothing compared the argument to the caller. Every other rider-scoped
--  function guards this; this one was missed because it is old and small.
--
--  It gains the same guard `rider_earnings_summary` already uses. That means
--  converting it from `language sql` to `plpgsql`, which is why the whole body
--  is reproduced rather than patched.
--
--  Forward-only. One new function, two redefinitions, no schema change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. rider_cash_held — the notes in the bag
-- ----------------------------------------------------------------------------

create or replace function public.rider_cash_held(p_rider_id uuid)
returns bigint language plpgsql stable security definer set search_path = public
as $$
begin
  if p_rider_id is distinct from auth.uid()
     and not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  /*
    CASH ONLY, and only the two kinds that are cash. `cod_collected` is
    positive (the rider owes it to the platform) and `cod_remitted` is already
    negative (0006 writes `-p_amount`), so a plain sum over the pair is the
    bag. `commission_earned`, `trip_pay`, `adjustment` and `platform_fee` are
    deliberately absent: they are what the rider is OWED or what the books say,
    not paper they are carrying.
  */
  return coalesce((
    select sum(l.amount)
      from public.cod_ledger l
     where l.rider_id = p_rider_id
       and l.settlement_id is null
       and l.kind in ('cod_collected', 'cod_remitted')
  ), 0)::bigint;
end $$;

comment on function public.rider_cash_held is
  'Physical cash a rider is carrying: COD collected less cash already handed '
  'in, on unsettled rows only. This is what "company cash you are holding" '
  'means. NOT rider_cod_in_hand, which nets pay owed as well and is the '
  'SETTLEMENT figure -- on a route day that one goes negative while the bag is '
  'full, which is the bug this function exists to end.';

grant execute on function public.rider_cash_held(uuid) to authenticated;
revoke execute on function public.rider_cash_held(uuid) from anon;

-- ----------------------------------------------------------------------------
-- 2. rider_cod_in_hand — same arithmetic, now with a guard
-- ----------------------------------------------------------------------------

create or replace function public.rider_cod_in_hand(p_rider_id uuid)
returns bigint language plpgsql stable security definer set search_path = public
as $$
begin
  /*
    0041: THE GUARD THIS NEVER HAD. `security definer` means RLS does not
    apply inside, and nothing compared the argument to the caller -- so any
    authenticated user could read any rider's cash position by passing their
    uuid. Same predicate `rider_earnings_summary` uses, so a rider reading
    their own summary still passes: that function calls this one with
    `v_rider := auth.uid()`.

    Office and service callers are unaffected: `admin_overview`,
    `remit_cod` and `cod_positions` all run as dispatch or service.
  */
  if p_rider_id is distinct from auth.uid()
     and not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Unchanged: every open row, whatever its kind. This is the settlement
  -- position, not the bag -- see rider_cash_held.
  return coalesce((
    select sum(l.amount)
      from public.cod_ledger l
     where l.rider_id = p_rider_id and l.settlement_id is null
  ), 0)::bigint;
end $$;

comment on function public.rider_cod_in_hand is
  'A rider''s unsettled NET position: cash collected less cash remitted less '
  'pay owed. What settlement nets to zero, and what remit_cod and '
  'riders_over_float measure against. For the cash actually in the bag use '
  'rider_cash_held -- this one goes negative on a route day.';

-- ----------------------------------------------------------------------------
-- 3. rider_earnings_summary — count collections from the event trail
--
--  0038's body. `picked_up_today` changes and `cash_held` is added; every
--  other key is byte-identical, because the header of the 0026 version warns
--  that splicing an older body silently reverts `earned_today` to
--  commission-only and that `route_flow` R7b is what catches it.
-- ----------------------------------------------------------------------------

create or replace function public.rider_earnings_summary(p_rider_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public
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
      -- 0041: the bag, beside the net. See rider_cash_held.
      'cash_held',        public.rider_cash_held(v_rider),
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
      /*
        0041: COUNTED FROM THE EVENT TRAIL, NOT FROM `trip_leg`.

        This used to read `o.trip_leg = 'pickup' and o.picked_up_at >= today`.
        `trip_leg` is where the parcel is GOING, and the office loading it onto
        a delivery run flips it to 'delivery' -- so a rider's whole morning
        vanished from this number the moment the shelf was sorted. Same mistake
        0028 fixed for picked_up_at: a physical fact stored in a column that
        describes intent.

        `order_status_events` is append-only and nothing reloads it. Either
        side of the pair credits the rider -- see the header for why both, and
        for the one benign false positive.
      */
      'picked_up_today',  coalesce((select count(*)
                                      from public.order_status_events e
                                      join public.orders o on o.id = e.order_id
                                     where e.to_status = 'picked_up'
                                       and e.created_at >= public.mm_day_start(v_today)
                                       and (e.actor_id = v_rider or o.rider_id = v_rider)), 0),
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

comment on function public.rider_earnings_summary is
  'Everything the rider app shows about money and today''s work. 0041: adds '
  'cash_held (the bag, beside the net position) and counts picked_up_today '
  'from order_status_events instead of orders.trip_leg, which the office '
  'flipped to ''delivery'' when it sorted the shelf -- erasing the rider''s '
  'collections from their own screen.';
