-- ============================================================================
--  MINGALAR EXPRESS  ·  0031 — TRADE AT ONCE, COD AFTER A LOOK
--
--  0026 made a new shop wait: it described itself, `approved_at` stayed null,
--  and `createOrder` refused every booking until the office pressed Confirm.
--  That is friction on the one day a merchant is most likely to give up, so
--  approval stops gating TRADE and starts gating CASH.
--
--      registers  ->  books prepaid parcels immediately
--      reviewed   ->  COD unlocked
--
--  The exposure being bounded is specific, and it is the reason this is not
--  simply "remove the check". An unvetted shop books COD parcels; a rider
--  collects the customer's money at the door; it enters cod_ledger against that
--  rider; the office discovers the shop was fictitious afterwards, holding cash
--  it owes to nobody and a rider whose float is wrong. Prepaid carries none of
--  that: the money never moves through us.
--
--  ---------------------------------------------------------------------------
--  WHY A TRIGGER AND NOT AN APP CHECK
--
--  `orders_insert_shop` is `owns_shop(shop_id) and created_by = auth.uid() and
--  status = 'pending'` and nothing else -- and `owns_shop` tests ownership
--  alone. So a shop owner holding a valid session can POST an order straight to
--  PostgREST, and neither RLS nor any CHECK looks at what state their shop is
--  in. Enforcing prepaid-only in `createOrder` would be advice.
--
--  While here, the same lookup closes a hole that predates this: a SUSPENDED or
--  REJECTED shop could also insert, because nothing below the application ever
--  checked `shops.is_active`. It has gone unnoticed because suspending a shop
--  usually deactivates its owner's profile too, and `auth_role()` returns NULL
--  for an inactive profile -- but that is only true while it is their ONLY shop.
--
--  An `awaiting` shop is `is_active = true` (0026 sets it on insert, saying
--  "not suspended; simply not yet approved"), so the active test admits exactly
--  the shops this migration is opening the door for.
--
--  Forward-only.
-- ============================================================================

set check_function_bodies = off;

create or replace function public.tg_orders_shop_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_s public.shops;
begin
  -- Seeds, migrations and the office act through the service role; dispatch
  -- creates orders on a shop's behalf over the phone. Neither is the case this
  -- gate exists for.
  if public.is_service_ctx() or public.is_dispatch() then
    return new;
  end if;

  select * into v_s from public.shops where id = new.shop_id;
  if not found then
    -- RLS will refuse this anyway; failing here first gives a better message.
    raise exception 'shop_not_found' using errcode = 'P0002';
  end if;

  if not v_s.is_active then
    raise exception 'shop_not_trading'
      using errcode = '42501',
            hint = 'This shop cannot take new orders. Contact the office.';
  end if;

  /*
    THE COD GATE. Prepaid is open from the first minute; cash waits for a human
    to have looked at the shop. `rejected_at` is not consulted -- a rejected
    shop is `is_active = false` and has already been refused above.
  */
  if new.payment_method = 'cod' and v_s.approved_at is null then
    raise exception 'cod_needs_review'
      using errcode = '42501',
            hint = 'Cash on delivery unlocks once the office has reviewed your '
                   'shop. Prepaid parcels can be booked now.';
  end if;

  return new;
end $$;

comment on function public.tg_orders_shop_gate is
  'Refuses an order from a shop that is not trading, and refuses COD from a '
  'shop the office has not reviewed. In the database because orders_insert_shop '
  'checks ownership only, so a shop owner can POST straight to PostgREST.';

drop trigger if exists orders_shop_gate on public.orders;
create trigger orders_shop_gate before insert on public.orders
for each row execute function public.tg_orders_shop_gate();

-- ----------------------------------------------------------------------------
--  GRANDFATHERING
--
--  Every shop that exists today was either approved by 0026's backfill or is
--  genuinely waiting. Nothing changes for them: the approved keep COD, and the
--  waiting can now trade prepaid instead of not at all. No data to migrate.
-- ----------------------------------------------------------------------------
