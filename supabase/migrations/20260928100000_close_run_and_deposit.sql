-- ============================================================================
-- 0052. CLOSING A RUN IS WHERE THE RIDER HANDS IN THE CASH
--
-- ----------------------------------------------------------------------------
-- THE BUSINESS MODEL, as the office runs it
--
--   * a rider never keeps any of the cash to cover their pay
--   * at the end of every run they hand in 100% of the cash they collected
--   * their earnings accumulate and are paid out at the monthly settlement
--
-- Until now "Close & pay" booked the rider's pay and nothing else. The cash
-- they brought back had to be recorded separately with remit_cod, from another
-- screen, and nothing connected the two -- so a run could be closed with its
-- cash never recorded as handed in, and the rider went on "holding" it.
--
-- ----------------------------------------------------------------------------
-- close_run_and_deposit(trip, expected_cash)
--
-- One transaction, so the run cannot close without its deposit or be deposited
-- without closing:
--
--   1. RUN CASH = the `cod_collected` lines for parcels delivered on this run.
--      From the LEDGER, not from the orders: it is exactly what the rider was
--      booked as holding, and it already excludes KBZPay (tg_orders_audit books
--      no cash line for a KPay delivery -- that money went to the bank).
--      Less anything already deposited against this run, so it cannot be
--      banked twice.
--   2. The office confirmed a figure on screen. If the ledger now says
--      something else -- a delivery landed after the dialog opened -- refuse:
--      a confirmation of the wrong amount is not a confirmation.
--   3. close_trip, unchanged: every guard (0050, 0051) and the rider's pay line,
--      which stays UNSETTLED -- that is "earned, to be paid at settlement".
--   4. One `cod_remitted` line for the full run cash, carrying the trip.
--
-- WHY NOT remit_cod. It refuses a deposit larger than rider_cod_in_hand, and
-- that balance is the sum of EVERY unsettled line, earnings included. Once
-- close_trip has booked the pay, "cash in hand" reads lower than the cash
-- actually in the rider's hand, and depositing all of it would be refused.
-- Under this model the pay is not an offset against the cash, so the deposit
-- is booked in full, directly.
-- ============================================================================

create or replace function public.close_run_and_deposit(
  p_trip_id       uuid,
  p_expected_cash bigint
)
returns public.trips
language plpgsql security definer
set search_path = public
as $$
declare
  v_t     public.trips;
  v_cash  bigint;
  v_done  bigint;
  v_due   bigint;
  v_code  text;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_t from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  -- 1. The cash this run's deliveries put in the rider's hand, before
  --    close_trip detaches anything.
  select coalesce(sum(l.amount), 0) into v_cash
    from public.cod_ledger l
    join public.orders o on o.id = l.order_id
   where o.trip_id  = p_trip_id
     and o.trip_leg = 'delivery'
     and l.kind     = 'cod_collected'
     and l.rider_id = v_t.rider_id;

  select coalesce(-sum(l.amount), 0) into v_done
    from public.cod_ledger l
   where l.trip_id = p_trip_id
     and l.kind    = 'cod_remitted';

  v_due := greatest(v_cash - v_done, 0);

  -- 2. The figure the office confirmed must still be the figure.
  if p_expected_cash is distinct from v_due then
    raise exception 'run_cash_changed: confirmed %, run has %', p_expected_cash, v_due
      using errcode = '55000',
            hint = 'The run''s cash changed since the dialog opened. Refresh and confirm again.';
  end if;

  -- 3. Close: all of close_trip's guards, and the pay line left unsettled.
  v_t := public.close_trip(p_trip_id);

  -- 4. The deposit, in full.
  if v_due > 0 then
    select r.code into v_code from public.routes r where r.id = v_t.route_id;
    insert into public.cod_ledger (order_id, trip_id, rider_id, kind, amount, created_by, memo)
    values (null, p_trip_id, v_t.rider_id, 'cod_remitted', -v_due,
            coalesce(auth.uid(), v_t.rider_id),
            'Run cash handed in · ' || coalesce(v_code, 'run') || ' '
              || to_char(v_t.service_date, 'YYYY-MM-DD'));
  end if;

  perform public.write_audit('trip.close_deposit', 'trips', v_t.id::text, null,
    jsonb_build_object('cash_collected', v_cash,
                       'already_deposited', v_done,
                       'deposited', v_due,
                       'pay_booked', v_t.total_pay));
  return v_t;
end $$;

comment on function public.close_run_and_deposit is
  'Closes a run and records the rider handing in 100% of the cash its '
  'deliveries collected, in one transaction. Refuses if the confirmed amount '
  'no longer matches the ledger. The rider''s pay stays unsettled for the '
  'monthly settlement; it is never netted against the cash.';

grant execute on function public.close_run_and_deposit(uuid, bigint) to authenticated;
revoke execute on function public.close_run_and_deposit(uuid, bigint) from anon;
