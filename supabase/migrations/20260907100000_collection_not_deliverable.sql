-- ============================================================================
--  MINGALAR EXPRESS  ·  0029 — A COLLECTION CANNOT BE DELIVERED
--
--  0028 made collection mandatory, so every parcel now travels on a pickup leg
--  before its delivery leg. The rider screen was written when no pickup run had
--  ever been loaded and branched on `leg !== 'return'`, which means a collection
--  inherited the entire delivery flow: a proof photo it cannot produce, "How did
--  the customer pay?" for a customer who is not there, and DONE - DELIVERED as
--  the primary green button.
--
--  Nothing refused the tap. advance_order had no trip_leg guard and
--  picked_up -> delivered is a legal transition, so a rider standing at the hub
--  could mark a shop's parcel delivered. cod_status becomes 'collected', the COD
--  is booked as cash they are holding, and the dashboard then tells them to hand
--  in money nobody ever gave them -- for a parcel sitting on our own shelf that
--  the customer has never seen.
--
--  A false COD ledger line is the hardest kind of error to unpick later, which
--  is why this is a database rule and not a hidden button.
--
--  Forward-only. Only advance_order changes, and only by the guard marked 0029.
-- ============================================================================

set check_function_bodies = off;

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

  /*
    0029 -- A COLLECTION IS NOT A DELIVERY.

    A pickup leg carries a parcel FROM a shop TO the hub. Its only rider
    transition is assigned -> picked_up, meaning "it is aboard"; it ends not
    with an action but with close_trip detaching it at the hub. There is no
    delivery to record, and the customer has not seen the parcel.

    Refused HERE and not only on screen. job-actions.tsx branched on
    `leg !== 'return'`, so a collection inherited the whole door-step flow --
    proof photo, "How did the customer pay?", and DONE - DELIVERED as the
    primary button. Marking it delivered stamps cod_status = 'collected' and
    books the COD as cash the rider holds, for a parcel on our own shelf. The
    screen is fixed in the same commit, but the offline queue replays
    advanceOrder from IndexedDB hours later, so a tap saved before that fix
    would still land. This is the part that cannot be replayed around.

    `failed` stays legal: a rider reaching a shut shop is the assigned ->
    failed case 0018 counts separately as an uncollected attempt.
  */
  if p_to = 'delivered' and v_o.trip_leg = 'pickup' then
    raise exception 'collection_not_deliverable'
      using errcode = '55000',
            hint = 'This parcel is being collected for the hub. It is delivered '
                   'on a later run, from the hub to the customer.';
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
