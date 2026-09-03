-- ============================================================================
--  MINGALAR EXPRESS  ·  0021 — KPAY, VERIFIED AGAINST THE BANK BEFORE IT COUNTS
--
--  A customer can now pay by KBZPay instead of cash. That sounds like a UI
--  choice and is not: it changes who holds the platform's money.
--
--  THE PROBLEM. tg_orders_audit books `cod_collected` to the RIDER on delivery
--  -- platform cash in the rider's pocket -- and settlement then demands it
--  back. A KPay transfer goes straight to the office account, so the rider holds
--  nothing. Booking it to them creates a debt they will be asked to settle in
--  cash they never took.
--
--  THE SHAPE OF THE ANSWER. `cod_ledger.rider_id` is NOT NULL on every row: it
--  is a rider ledger, not a general one. So "book it to the platform instead" is
--  not a different row -- IT IS NO ROW. The rider's ledger stays silent because
--  the rider owes nothing, and the platform's record of the receipt is the order
--  itself: collected_via, the receipt screenshot, and who confirmed it when.
--
--  A general (non-rider) ledger is the right long-term home for platform
--  receipts and is DEFERRED, deliberately: adding one means making rider_id
--  nullable on the table every settlement is built from.
--
--  The rider's COMMISSION still books normally. They did the delivery.
--
--  THREE STATES, and the middle one is the whole point:
--
--    delivered, cash    cod_status = collected     rider owes it
--    delivered, kpay    cod_status = kpay_pending  NOBODY owes it yet; the
--                                                  office has not checked the
--                                                  bank
--    confirmed          cod_status = settled       money is in and closed out
--
--  A REJECTED receipt (wrong amount, a screenshot of somebody else's transfer)
--  leaves the parcel DELIVERED -- the customer has the goods -- and returns
--  cod_status to `pending`, which reads correctly as "cash outstanding, nobody
--  holding it". The reason is written into the contact log so the office has it
--  in the parcel's own story, not in a column nobody opens.
--
--  Forward-only. Depends on 0020 for the enum value.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. How it was paid, and the evidence
-- ----------------------------------------------------------------------------

alter table public.orders
  add column if not exists collected_via      text
    check (collected_via is null or collected_via in ('cash','kpay')),
  add column if not exists kpay_proof_path    text,
  add column if not exists kpay_confirmed_at  timestamptz,
  add column if not exists kpay_confirmed_by  uuid references public.profiles(id) on delete set null,
  add column if not exists kpay_rejected_at   timestamptz,
  add column if not exists kpay_reject_reason text;

alter table public.orders drop constraint if exists orders_kpay_needs_receipt;
alter table public.orders
  -- The counterpart of orders_delivered_needs_proof. A KPay delivery with no
  -- receipt is a claim with no evidence, and unlike cash there is no float to
  -- count at the end of the shift that would catch it.
  add constraint orders_kpay_needs_receipt
    check (collected_via <> 'kpay' or status <> 'delivered' or kpay_proof_path is not null);

alter table public.orders drop constraint if exists orders_kpay_decision_stamped;
alter table public.orders
  add constraint orders_kpay_decision_stamped
    check (
      (kpay_confirmed_at is null or kpay_rejected_at is null)
      and (kpay_reject_reason is null or kpay_rejected_at is not null)
    );

-- The admin queue's only query: KPay deliveries nobody has checked yet.
create index if not exists orders_kpay_pending_idx
  on public.orders (delivered_at desc)
  where collected_via = 'kpay' and cod_status = 'kpay_pending';

comment on column public.orders.collected_via is
  'cash | kpay, set at delivery. A kpay order books NO cod_collected ledger '
  'line -- the rider never held the money. See tg_orders_audit.';
comment on column public.orders.kpay_proof_path is
  'delivery-proofs object path for the KBZPay receipt screenshot. The only '
  'evidence a transfer happened; required by orders_kpay_needs_receipt.';


-- ----------------------------------------------------------------------------
-- 2. What the rider shows the customer
--
--  In app_settings so the office can change the account without a deploy. The
--  QR is a PATH, not a signed URL: a rider in a stairwell with no signal still
--  has to be able to show it, so it is served from the app's own static assets
--  and cached by the service worker.
-- ----------------------------------------------------------------------------

alter table public.app_settings
  add column if not exists kpay_account_name text,
  add column if not exists kpay_phone        text,
  add column if not exists kpay_qr_url       text not null default '/kpay-qr.png';

update public.app_settings
   set kpay_account_name = coalesce(kpay_account_name, 'Yan Naing Htun'),
       kpay_phone        = coalesce(kpay_phone, '+959764148037')
 where id;

comment on column public.app_settings.kpay_qr_url is
  'Static path to the KBZPay QR image, so it renders with no network. Replace '
  'public/kpay-qr.png to change it.';


-- ----------------------------------------------------------------------------
-- 3. tg_orders_audit — the one branch that matters
--
--  0007's body unchanged apart from the KPay condition on the cod_collected
--  insert. Spliced from 0007, not 0002: 0007 added `old.trip_id is null` to the
--  capacity release, and taking the older body would silently revert it.
-- ----------------------------------------------------------------------------

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
  -- `old.trip_id is null` is the route-model guard: load_trip() never took a
  -- capacity slot, so releasing one here would drive the counter negative.
  if old.rider_id is not null
     and old.trip_id is null
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
  --
  -- Route orders leave the commission columns NULL, so the guard below skips
  -- them and they book only the cash line. Their pay arrives once per run as a
  -- single 'trip_pay' line from close_trip(). No branch on trip_id needed.
  if new.status = 'delivered' and old.status <> 'delivered' and new.rider_id is not null then
    -- THE KPAY BRANCH (0021). `cod_ledger` is a RIDER ledger -- rider_id is NOT
    -- NULL on every row -- so "book it to the platform instead" is not a
    -- different row, it is NO row. The rider never touched the money, so their
    -- ledger must not mention it, and settlement must not ask them for it.
    --
    -- The platform's record of the receipt is the order itself:
    -- collected_via, kpay_proof_path and the confirmation stamp. A general
    -- (non-rider) ledger is the right long-term home for it and is noted as
    -- deferred; inventing one here would mean making rider_id nullable on the
    -- table every settlement is built from.
    if new.payment_method = 'cod' and new.cod_amount > 0
       and coalesce(new.collected_via, 'cash') <> 'kpay' then
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

-- ----------------------------------------------------------------------------
-- 4. advance_order — asks how, and demands the receipt
--
--  DROPPED FIRST, then recreated. Adding two defaulted parameters to a
--  `create or replace` does NOT replace the function -- Postgres keeps both
--  signatures as overloads and PostgREST then cannot tell which one a call
--  means. 0013's body otherwise, with the two new guards.
-- ----------------------------------------------------------------------------

drop function if exists public.advance_order(
  uuid, public.order_status, double precision, double precision, text, text, text);

create or replace function public.advance_order(
  p_order_id uuid,
  p_to       public.order_status,
  p_lat      double precision default null,
  p_lng      double precision default null,
  p_proof    text default null,
  p_receiver text default null,
  p_reason   text default null,
  -- 0021: how the customer paid, and the receipt for it.
  p_collected_via text default null,
  p_kpay_proof    text default null
) returns public.orders
language plpgsql security definer
set search_path = public
as $$
declare
  v_o   public.orders;
  v_via text := nullif(trim(coalesce(p_collected_via, '')), '');
begin
  if v_via is not null and v_via not in ('cash','kpay') then
    raise exception 'bad_collected_via: %', v_via using errcode = '22023';
  end if;
  if p_to not in ('picked_up','delivered','failed','returned') then
    raise exception 'advance_order handles picked_up | delivered | failed | returned only'
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

  -- A NAME, not a photo. See the header: the dispute a return invites is "you
  -- never brought it back", and a name plus a timestamp answers it. A photo is
  -- still accepted and stored if the rider takes one.
  if p_to = 'returned' and coalesce(nullif(trim(p_receiver), ''), v_o.proof_receiver) is null then
    raise exception 'receiver_required'
      using errcode = '55000',
            hint = 'Record who at the shop took the parcel back.';
  end if;

  if p_to = 'failed' and coalesce(nullif(trim(p_reason), ''), v_o.fail_reason) is null then
    raise exception 'fail_reason_required' using errcode = '55000';
  end if;

  -- CASH IS THE DEFAULT, NOT AN ERROR.
  --
  -- The first draft raised `payment_method_required` when a COD delivery did not
  -- say how it was paid. That is the tidier rule and it is the wrong one: it
  -- breaks every existing caller, and — far worse — a rider whose phone is
  -- running last week's build would find deliveries REFUSED at the doorstep with
  -- an error they cannot act on. Cash is what every parcel before this migration
  -- was, so an unstated channel means cash, which is both true of history and
  -- the safe direction: the rider is asked for the money and the shift float
  -- catches any disagreement.
  --
  -- The requirement to CHOOSE lives in the rider UI, where a person can answer
  -- it. The guarantee that matters lives in the constraint:
  -- orders_kpay_needs_receipt makes a receiptless KPay delivery unrepresentable.

  -- And a KPay payment must come with its receipt. This is the ONLY evidence the
  -- office has that a transfer happened at all -- the rider holds no cash, so
  -- there is nothing to count at the end of the shift that would catch a lie.
  if p_to = 'delivered' and coalesce(v_via, v_o.collected_via) = 'kpay'
     and coalesce(p_kpay_proof, v_o.kpay_proof_path) is null then
    raise exception 'kpay_proof_required' using errcode = '55000',
      hint = 'Upload the KPay receipt screenshot, then pass its object path.';
  end if;

  perform set_config('app.event_lat',  coalesce(p_lat::text, ''), true);
  perform set_config('app.event_lng',  coalesce(p_lng::text, ''), true);
  perform set_config('app.event_note', coalesce(p_reason, ''),    true);

  update public.orders set
      status           = p_to,
      proof_photo_path = coalesce(p_proof, proof_photo_path),
      proof_receiver   = coalesce(nullif(trim(p_receiver), ''), proof_receiver),
      -- Defaults to cash on a COD delivery; see the note above.
      collected_via    = case
                           when p_to = 'delivered' and payment_method = 'cod'
                             then coalesce(v_via, collected_via, 'cash')
                           else coalesce(v_via, collected_via)
                         end,
      kpay_proof_path  = coalesce(p_kpay_proof, kpay_proof_path),
      fail_reason      = case when p_to = 'failed'
                              then coalesce(nullif(trim(p_reason), ''), fail_reason)
                              else fail_reason end
   where id = p_order_id
   returning * into v_o;

  -- The status machine has already stamped cod_status = 'collected' for a COD
  -- delivery. For KPay that is wrong in the one way that matters -- it says the
  -- rider has the cash -- so it is corrected here, AFTER the machine has run,
  -- and no cod_collected ledger line was written (see tg_orders_audit).
  if p_to = 'delivered' and v_o.collected_via = 'kpay' and v_o.payment_method = 'cod' then
    update public.orders set cod_status = 'kpay_pending'
     where id = p_order_id returning * into v_o;
  end if;

  perform set_config('app.event_lat', '', true);
  perform set_config('app.event_lng', '', true);
  perform set_config('app.event_note', '', true);

  return v_o;
end $$;

-- ----------------------------------------------------------------------------
-- 5. confirm_kpay_payment — the office has checked the bank
--
--  Dispatch-only, and this is the moment the money becomes real to the system.
--  No ledger line is written for the same reason none was written at delivery:
--  the rider is not part of this transaction.
-- ----------------------------------------------------------------------------

create or replace function public.confirm_kpay_payment(p_order_id uuid)
returns public.orders
language plpgsql security definer
set search_path = public
as $$
declare v_o public.orders;
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if v_o.collected_via is distinct from 'kpay' then
    raise exception 'not_a_kpay_payment' using errcode = '55000';
  end if;
  if v_o.cod_status <> 'kpay_pending' then
    raise exception 'kpay_already_decided: %', v_o.cod_status using errcode = '55000',
      hint = 'This transfer has already been confirmed or rejected.';
  end if;

  update public.orders set
      cod_status         = 'settled',
      kpay_confirmed_at  = now(),
      kpay_confirmed_by  = auth.uid(),
      kpay_rejected_at   = null,
      kpay_reject_reason = null
   where id = p_order_id
  returning * into v_o;

  insert into public.order_notes (order_id, author_id, author_role, kind, body)
  values (p_order_id, auth.uid(), public.auth_role(), 'decision',
          format('KPay transfer of %s Ks confirmed against the bank.', v_o.cod_amount));

  perform public.write_audit('order.kpay_confirm', 'orders', p_order_id::text,
    jsonb_build_object('cod_status', 'kpay_pending'),
    jsonb_build_object('cod_status', 'settled', 'amount', v_o.cod_amount));

  return v_o;
end $$;


-- ----------------------------------------------------------------------------
-- 6. reject_kpay_payment — the receipt did not check out
--
--  The parcel STAYS DELIVERED. The customer has the goods either way, and
--  rewinding the status would erase a delivery that really happened. What
--  changes is the money: cod_status returns to `pending`, which reads correctly
--  as "outstanding, and nobody is holding it", and the office chases it.
-- ----------------------------------------------------------------------------

create or replace function public.reject_kpay_payment(
  p_order_id uuid,
  p_reason   text
) returns public.orders
language plpgsql security definer
set search_path = public
as $$
declare
  v_o      public.orders;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- A rejection with no reason is unchaseable: the office cannot ring anyone
  -- about "the screenshot was wrong".
  if v_reason is null or length(v_reason) < 4 then
    raise exception 'reject_reason_required' using errcode = '22023',
      hint = 'Say what was wrong with the receipt.';
  end if;

  select * into v_o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if v_o.collected_via is distinct from 'kpay' then
    raise exception 'not_a_kpay_payment' using errcode = '55000';
  end if;
  if v_o.cod_status <> 'kpay_pending' then
    raise exception 'kpay_already_decided: %', v_o.cod_status using errcode = '55000';
  end if;

  update public.orders set
      cod_status         = 'pending',
      kpay_rejected_at   = now(),
      kpay_reject_reason = v_reason,
      kpay_confirmed_at  = null,
      kpay_confirmed_by  = null
   where id = p_order_id
  returning * into v_o;

  insert into public.order_notes (order_id, author_id, author_role, kind, body)
  values (p_order_id, auth.uid(), public.auth_role(), 'decision',
          format('KPay receipt REJECTED (%s Ks outstanding): %s', v_o.cod_amount, v_reason));

  perform public.write_audit('order.kpay_reject', 'orders', p_order_id::text,
    jsonb_build_object('cod_status', 'kpay_pending'),
    jsonb_build_object('cod_status', 'pending', 'reason', v_reason,
                       'amount', v_o.cod_amount));

  return v_o;
end $$;

comment on function public.confirm_kpay_payment is
  'Dispatch confirms a KBZPay transfer against the bank. No ledger line: the '
  'rider never held the money, so their settlement must not mention it.';
comment on function public.reject_kpay_payment is
  'Dispatch rejects a KBZPay receipt. The parcel stays delivered -- the customer '
  'has the goods -- and the money returns to `pending` for the office to chase.';


-- ----------------------------------------------------------------------------
-- 7. GRANTS
-- ----------------------------------------------------------------------------

grant execute on function
  public.advance_order(uuid, public.order_status, double precision, double precision,
                       text, text, text, text, text),
  public.confirm_kpay_payment(uuid),
  public.reject_kpay_payment(uuid, text)
to authenticated;

revoke execute on function
  public.advance_order(uuid, public.order_status, double precision, double precision,
                       text, text, text, text, text),
  public.confirm_kpay_payment(uuid),
  public.reject_kpay_payment(uuid, text)
from anon;
