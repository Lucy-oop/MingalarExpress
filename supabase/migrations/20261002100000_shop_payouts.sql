-- ============================================================================
-- 0056. SHOP PAYOUTS: A LEDGER FOR WHAT WE HAVE PAID EACH SHOP
--
-- ----------------------------------------------------------------------------
-- WHY
--
-- What a shop is owed has always been DERIVED (cod_by_shop, 0022): goods value
-- on delivered COD parcels, less the delivery fees charged to the shop. But
-- nothing recorded a payment. Paying a shop never reduced "owed to you", so
-- the office kept the real account on paper and the shop's Money page carried
-- a disclaimer saying it was not a statement.
--
-- ----------------------------------------------------------------------------
-- THE MODEL
--
--   shop_ledger    one append-only row per payout: amount, channel (cash at the
--                  desk, KBZPay, CB Pay, WavePay, AYA Pay), reference, memo,
--                  and for the Direct house shop the sender who was paid.
--                  Written ONLY by record_shop_payout; never edited or deleted.
--
--   shop_balances  per shop, all time:
--       goods_collected    goods value on delivered COD parcels whose payment
--                          reached us (the shop's share, before fees)
--       fees_deducted      delivery fees charged to the SHOP: on shop-pays COD
--                          parcels, on prepaid parcels, and on parcels whose
--                          payment never arrived. A fee the customer paid at
--                          the door never passes through the shop's money.
--       owed_total         goods_collected - fees_deducted  (= cod_by_shop's
--                          owed_to_shop, over all time)
--       pending_clearance  the part of owed_total still on its way to us:
--                          cash on a run not yet closed and deposited
--       available          owed_total - pending_clearance - paid_out
--
-- CLEARED means the office actually holds the money:
--   cash    the parcel's run is closed (0052 deposits the cash at close), or
--           its cod_status reached remitted / settled (the pre-0052 path)
--   KBZPay  the office confirmed the receipt (cod_status = settled)
--
-- A PAYOUT CAN NEVER EXCEED `available`. record_shop_payout locks the shop row
-- so two admins paying the same shop at once cannot both pass the check.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shop_ledger
-- ----------------------------------------------------------------------------
create table if not exists public.shop_ledger (
  id          bigserial primary key,
  shop_id     uuid not null references public.shops(id) on delete restrict,
  kind        text not null,
  -- Signed from the shop's side: a payout is NEGATIVE (it reduces what we owe).
  amount      bigint not null,
  method      text,
  reference   text,
  memo        text,
  -- Direct house shop only: the sender this payout went to.
  recipient   text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.shop_ledger drop constraint if exists shop_ledger_kind_known;
alter table public.shop_ledger
  add constraint shop_ledger_kind_known check (kind in ('payout'));
alter table public.shop_ledger drop constraint if exists shop_ledger_nonzero;
alter table public.shop_ledger
  add constraint shop_ledger_nonzero check (amount <> 0);
alter table public.shop_ledger drop constraint if exists shop_ledger_method_known;
alter table public.shop_ledger
  add constraint shop_ledger_method_known
  check (method is null or method in ('cash', 'kbzpay', 'cbpay', 'wavepay', 'ayapay'));
alter table public.shop_ledger drop constraint if exists shop_ledger_payout_shape;
alter table public.shop_ledger
  add constraint shop_ledger_payout_shape
  check (kind <> 'payout' or (amount < 0 and method is not null));

create index if not exists shop_ledger_shop_idx on public.shop_ledger (shop_id, created_at desc);

comment on table public.shop_ledger is
  'Payouts to shops, append-only. A payout is negative (it reduces what the '
  'platform owes the shop). Written only by record_shop_payout (0056).';

-- ----------------------------------------------------------------------------
-- 2. Access: a shop reads its own; the office reads all; nobody writes directly
-- ----------------------------------------------------------------------------
alter table public.shop_ledger enable row level security;

drop policy if exists shop_ledger_read on public.shop_ledger;
create policy shop_ledger_read on public.shop_ledger
  for select to authenticated
  using (public.owns_shop(shop_id) or public.is_dispatch());

revoke all on public.shop_ledger from anon;
revoke insert, update, delete on public.shop_ledger from authenticated;
grant select on public.shop_ledger to authenticated;
grant all on public.shop_ledger to service_role;
revoke all on sequence public.shop_ledger_id_seq from anon, authenticated;

-- Append-only for EVERYONE, like cod_ledger (0055).
create or replace function public.tg_shop_ledger_append_only()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception 'shop_ledger_append_only' using errcode = '42501',
    hint = 'Shop payouts are never edited or deleted.';
end $$;

drop trigger if exists shop_ledger_append_only on public.shop_ledger;
create trigger shop_ledger_append_only before update or delete on public.shop_ledger
for each row execute function public.tg_shop_ledger_append_only();

-- Every row is audited, however it was written.
create or replace function public.tg_shop_ledger_audit()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.write_audit('shop.' || new.kind, 'shop_ledger', new.id::text, null,
    jsonb_build_object('shop_id',   new.shop_id,
                       'amount',    new.amount,
                       'method',    new.method,
                       'reference', new.reference,
                       'memo',      new.memo,
                       'recipient', new.recipient,
                       'created_by', new.created_by));
  return new;
end $$;

drop trigger if exists shop_ledger_audit on public.shop_ledger;
create trigger shop_ledger_audit after insert on public.shop_ledger
for each row execute function public.tg_shop_ledger_audit();

-- ----------------------------------------------------------------------------
-- 3. shop_balances
-- ----------------------------------------------------------------------------
create or replace function public.shop_balances(p_shop_id uuid default null)
returns table (
  shop_id            uuid,
  shop_name          text,
  is_direct          boolean,
  delivered          bigint,
  goods_collected    bigint,
  fees_deducted      bigint,
  owed_total         bigint,
  pending_clearance  bigint,
  unreceived         bigint,
  paid_out           bigint,
  available          bigint,
  last_payout_at     timestamptz
)
language sql stable security definer
set search_path = public
as $$
  with visible as (
    -- A shop sees its own; the office sees every shop.
    select s.id, s.name, s.is_direct
      from public.shops s
     where (p_shop_id is null or s.id = p_shop_id)
       and (public.is_dispatch() or public.is_service_ctx() or public.owns_shop(s.id))
  ),
  per_order as (
    select
      o.shop_id,
      o.delivery_fee as fee,
      o.payment_method = 'cod' and o.cod_amount > 0
        and not public.cod_unreceived(o.status, o.payment_method, o.cod_amount, o.cod_status)
        as received,
      -- The shop's goods share of what was collected (before fees).
      case when o.fee_payer = 'customer' then o.cod_amount - o.delivery_fee else o.cod_amount end
        as goods,
      o.payment_method,
      o.fee_payer,
      -- Is the money in the office's hands?
      case
        when coalesce(o.collected_via, 'cash') = 'kpay' then o.cod_status = 'settled'
        else o.cod_status in ('remitted', 'settled')
             or exists (select 1 from public.trips t
                         where t.id = o.trip_id and t.status = 'closed')
      end as cleared,
      o.cod_amount
    from public.orders o
    join visible v on v.id = o.shop_id
   where o.status = 'delivered'
  ),
  money as (
    select
      p.shop_id,
      count(*)::bigint as delivered,
      coalesce(sum(p.goods) filter (where p.received), 0)::bigint as goods_collected,
      coalesce(sum(p.fee) filter (
        where not p.received                                  -- prepaid, or payment never arrived
           or (p.received and p.fee_payer = 'shop')           -- shop pays the fee on COD
      ), 0)::bigint as fees_deducted,
      coalesce(sum(
        (case when p.fee_payer = 'shop' then p.goods - p.fee else p.goods end)
      ) filter (where p.received and not p.cleared), 0)::bigint as pending_clearance,
      coalesce(sum(p.cod_amount) filter (
        where p.payment_method = 'cod' and p.cod_amount > 0 and not p.received
      ), 0)::bigint as unreceived
    from per_order p
    group by p.shop_id
  ),
  paid as (
    select l.shop_id, coalesce(-sum(l.amount), 0)::bigint as paid_out, max(l.created_at) as last_at
      from public.shop_ledger l
      join visible v on v.id = l.shop_id
     where l.kind = 'payout'
     group by l.shop_id
  )
  select
    v.id,
    v.name,
    v.is_direct,
    coalesce(m.delivered, 0),
    coalesce(m.goods_collected, 0),
    coalesce(m.fees_deducted, 0),
    coalesce(m.goods_collected, 0) - coalesce(m.fees_deducted, 0),
    coalesce(m.pending_clearance, 0),
    coalesce(m.unreceived, 0),
    coalesce(p.paid_out, 0),
    coalesce(m.goods_collected, 0) - coalesce(m.fees_deducted, 0)
      - coalesce(m.pending_clearance, 0) - coalesce(p.paid_out, 0),
    p.last_at
  from visible v
  left join money m on m.shop_id = v.id
  left join paid  p on p.shop_id = v.id
  order by 11 desc, v.name
$$;

comment on function public.shop_balances is
  'All-time account per shop: goods collected, fees deducted, pending '
  'clearance, paid out, and what is available to pay now. A shop sees its own, '
  'the office every shop (0056).';

-- ----------------------------------------------------------------------------
-- 4. record_shop_payout: the only way money leaves for a shop
-- ----------------------------------------------------------------------------
create or replace function public.record_shop_payout(
  p_shop_id   uuid,
  p_amount    bigint,
  p_method    text,
  p_reference text default null,
  p_memo      text default null,
  p_recipient text default null
)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  v_shop      public.shops;
  v_available bigint;
begin
  if not (public.is_admin() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_must_be_positive' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('cash', 'kbzpay', 'cbpay', 'wavepay', 'ayapay') then
    raise exception 'payout_method_unknown' using errcode = '22023';
  end if;
  -- A transfer is traceable only by its reference; cash at the desk may have none.
  if p_method <> 'cash' and length(trim(coalesce(p_reference, ''))) = 0 then
    raise exception 'payout_reference_required' using errcode = '22023',
      hint = 'Enter the transaction reference for a KBZPay / CB Pay / WavePay / AYA Pay transfer.';
  end if;

  -- The lock that makes the balance check hold: two payouts to one shop queue.
  select * into v_shop from public.shops where id = p_shop_id for update;
  if not found then
    raise exception 'shop_not_found' using errcode = 'P0002';
  end if;
  -- The Direct house shop pools many senders; say who was paid.
  if v_shop.is_direct and length(trim(coalesce(p_recipient, ''))) = 0 then
    raise exception 'payout_recipient_required' using errcode = '22023',
      hint = 'Name the sender this Direct payout went to.';
  end if;

  select b.available into v_available from public.shop_balances(p_shop_id) b;
  v_available := coalesce(v_available, 0);
  if p_amount > v_available then
    raise exception 'payout_exceeds_available: available %, requested %', v_available, p_amount
      using errcode = '55000',
            hint = 'Only money that has reached the office can be paid out.';
  end if;

  insert into public.shop_ledger (shop_id, kind, amount, method, reference, memo, recipient, created_by)
  values (p_shop_id, 'payout', -p_amount, p_method,
          nullif(trim(coalesce(p_reference, '')), ''),
          nullif(trim(coalesce(p_memo, '')), ''),
          nullif(trim(coalesce(p_recipient, '')), ''),
          auth.uid());

  return v_available - p_amount;
end $$;

comment on function public.record_shop_payout is
  'Records a payout to a shop: refuses more than the shop''s available '
  '(cleared) balance, needs a reference for digital channels and a recipient '
  'for the Direct shop, and writes one append-only, audited shop_ledger row.';

-- ----------------------------------------------------------------------------
-- 5. Grants, in 0054's shape: nothing is PUBLIC's
-- ----------------------------------------------------------------------------
revoke execute on function public.shop_balances(uuid) from public;
revoke execute on function public.record_shop_payout(uuid, bigint, text, text, text, text) from public;
revoke execute on function public.tg_shop_ledger_append_only() from public;
revoke execute on function public.tg_shop_ledger_audit() from public;
grant execute on function public.shop_balances(uuid) to authenticated, service_role;
grant execute on function public.record_shop_payout(uuid, bigint, text, text, text, text) to authenticated, service_role;
