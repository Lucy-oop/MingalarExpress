-- ============================================================================
--  MINGALAR EXPRESS  ·  0022 — MONEY NOBODY RECEIVED IS NOT MONEY OWED
--
--  Found by reading 0021 back. `cod_by_shop` computes what the platform owes a
--  shop from `status = 'delivered'` alone and never looks at `cod_status`:
--
--      when o.fee_payer = 'customer' then o.cod_amount - o.delivery_fee
--
--  Before 0021 that was safe -- a delivered COD parcel was always `collected`,
--  so `delivered` implied the money had arrived. 0021 broke that implication and
--  I did not notice: a REJECTED KBZPay receipt leaves the parcel delivered
--  (correctly -- the customer has the goods) with cod_status back at `pending`,
--  and /shop/money then told the shop it was owed 45,000 Ks the platform never
--  received. The office would have paid out cash it never took in.
--
--  THE CORRECT ARITHMETIC. A delivered parcel whose COD never arrived is, from
--  the money's point of view, a PREPAID parcel: the service was rendered so the
--  delivery fee is earned, and no cash came in so there is nothing to pass on.
--  Net owed to the shop is therefore MINUS the fee, exactly as for prepaid.
--
--      collected 48,500  ->  owed 45,000   (fee 3,500 kept)
--      collected      0  ->  owed  -3,500  (fee still earned)
--
--  AND IT INCLUDES THE VERIFICATION WINDOW, deliberately. `kpay_pending` -- a
--  transfer the office has not yet checked against the bank -- is also money
--  nobody has. A shop should not be told it is owed for a receipt nobody has
--  looked at; when the office confirms it, cod_status becomes `settled` and the
--  figure moves into `cod_collected` on its own.
--
--  THE SHORTFALL IS STATED, not silently subtracted. A shop that just saw a
--  smaller number would ring the office. A shop that sees "45,000 not received"
--  knows what the call is about.
--
--  Forward-only. DROP then CREATE, because adding a column to a RETURNS TABLE
--  changes the function's output signature and `create or replace` refuses it.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. cod_unreceived — the one condition, in one place
--
--  Scalar arguments rather than a row type so it is immutable and parallel
--  safe, and so it reads the same in a filter as it does in a CASE. It is
--  referenced five times in the function below; the last two migrations were
--  both bitten by the same arithmetic living in two places.
-- ----------------------------------------------------------------------------

create or replace function public.cod_unreceived(
  p_status     public.order_status,
  p_payment    public.payment_method,
  p_cod        bigint,
  p_cod_status public.cod_status
) returns boolean
language sql immutable parallel safe
set search_path = public
as $$
  select p_status = 'delivered'
     and p_payment = 'cod'
     and p_cod > 0
     -- pending      = a KBZPay receipt the office rejected
     -- kpay_pending = one it has not checked yet
     and p_cod_status in ('pending', 'kpay_pending')
$$;

comment on function public.cod_unreceived is
  'TRUE for a delivered COD parcel whose money never arrived: a rejected KBZPay '
  'receipt, or one still awaiting verification. Such a parcel earns the delivery '
  'fee and passes nothing on -- see cod_by_shop.';


-- ----------------------------------------------------------------------------
-- 2. cod_by_shop — 0006's body, four aggregates corrected and one added
-- ----------------------------------------------------------------------------

drop function if exists public.cod_by_shop(date, date);

create or replace function public.cod_by_shop(p_from date default null, p_to date default null)
returns table (
  shop_id        uuid,
  shop_name      text,
  owner_name     text,
  delivered      bigint,
  in_transit     bigint,
  cod_collected  bigint,
  goods_value    bigint,
  platform_fees  bigint,
  owed_to_shop   bigint,
  cod_unreceived bigint
)
language sql stable security invoker
set search_path = public
as $$
  with bounds as (
    select public.mm_day_start(coalesce(p_from, public.mm_today() - 30)) as starts_at,
           public.mm_day_end(coalesce(p_to, public.mm_today()))         as ends_at
  )
  select
    s.id,
    s.name,
    p.full_name,
    count(*) filter (where o.status = 'delivered'),
    count(*) filter (where o.status in ('assigned','picked_up')),
    -- COLLECTED means it arrived. A KPay transfer the office has not verified,
    -- or one it rejected, is money nobody has -- see cod_unreceived below.
    coalesce(sum(o.cod_amount) filter (
      where o.status = 'delivered' and not public.cod_unreceived(o.status, o.payment_method, o.cod_amount, o.cod_status)), 0)::bigint,
    coalesce(sum(
      case when o.status <> 'delivered' then 0
           when o.payment_method <> 'cod' then 0
           -- Consistent with cod_collected on purpose: a money page whose parts
           -- do not sum to its total is a money page nobody believes.
           when not (not public.cod_unreceived(o.status, o.payment_method, o.cod_amount, o.cod_status)) then 0
           when o.fee_payer = 'customer' then o.cod_amount - o.delivery_fee
           else o.cod_amount
      end), 0)::bigint,
    coalesce(sum(o.delivery_fee) filter (where o.status = 'delivered'), 0)::bigint,
    coalesce(sum(
      case when o.status <> 'delivered' then 0
           when o.payment_method <> 'cod' then -o.delivery_fee
           -- THE BUG THIS MIGRATION FIXES. The platform collected nothing, so it
           -- owes the shop nothing for the goods -- but the parcel WAS delivered,
           -- so the delivery fee is still earned. Net: the shop owes the fee,
           -- exactly as on a prepaid parcel. Before this, a rejected KPay told
           -- the shop it was owed the full goods value of money never received.
           when not (not public.cod_unreceived(o.status, o.payment_method, o.cod_amount, o.cod_status)) then -o.delivery_fee
           when o.fee_payer = 'customer' then o.cod_amount - o.delivery_fee
           else o.cod_amount - o.delivery_fee
      end), 0)::bigint,
    -- The shortfall, stated rather than silently missing. A shop that simply
    -- saw a smaller number would ring the office; a shop that sees "45,000 not
    -- received" knows what the conversation is about.
    coalesce(sum(o.cod_amount) filter (
      where o.status = 'delivered' and public.cod_unreceived(
        o.status, o.payment_method, o.cod_amount, o.cod_status)), 0)::bigint
  from public.shops s
  join public.profiles p on p.id = s.owner_id
  cross join bounds b
  left join public.orders o on o.shop_id = s.id
        and o.created_at >= b.starts_at and o.created_at < b.ends_at
  group by s.id, s.name, p.full_name
  order by s.name;
$$;
comment on function public.cod_by_shop is
  'What the platform owes each shop, derived from orders. Since 0022 it counts '
  'only COD that actually arrived; the rest is reported as cod_unreceived so a '
  'shortfall is visible rather than merely absent.';

grant execute on function public.cod_unreceived(
  public.order_status, public.payment_method, bigint, public.cod_status) to authenticated;
grant execute on function public.cod_by_shop(date, date) to authenticated;
revoke execute on function public.cod_by_shop(date, date) from anon;
