-- ============================================================================
-- 0048. OUTSIDE WAY: PARCELS THE OFFICE BOOKS BY HAND
--
-- ----------------------------------------------------------------------------
-- WHY
--
-- Some shops and customers never open the portal. They send the order in a
-- Telegram, Viber or Facebook message, or ring it in, and the office types it
-- up at /admin/outside-way. Two things about such a parcel were unrecordable:
--
--   * WHERE IT CAME FROM. Every order looked portal-booked, so the office could
--     not answer "how much of our volume still arrives by chat".
--   * WHO SENT IT, when the sender has no shop account. `orders.shop_id` is
--     NOT NULL and settlement is per shop, so an unregistered sender needs a
--     shop to hang the parcel on -- and their own name and phone beside it.
--
-- ----------------------------------------------------------------------------
-- THE HOUSE "DIRECT" SHOP
--
-- One shop row, flagged `is_direct`, owns every unregistered sender's parcel.
-- Its COD settles as one ledger, and the office pays each sender by hand from
-- `sender_name` / `sender_phone`. The row is created by the app on first use
-- (lib/admin/outside-way.ts), owned by the admin who books that first parcel,
-- because a migration has no office profile to name as `owner_id`.
--
-- At most one: `shops_one_direct`. And only the office may set the flag -- see
-- `tg_shops_direct_guard` -- because the house shop is where the office files
-- parcels, and a shop owner who could flag their own shop would be handed
-- every direct sender's cash.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. orders: channel and sender
-- ----------------------------------------------------------------------------
alter table public.orders
  add column if not exists source text not null default 'portal',
  add column if not exists sender_name  text,
  add column if not exists sender_phone text;

alter table public.orders drop constraint if exists orders_source_known;
alter table public.orders
  add constraint orders_source_known
  check (source in ('portal', 'telegram', 'viber', 'facebook', 'phone', 'other'));

alter table public.orders drop constraint if exists orders_sender_name_len;
alter table public.orders
  add constraint orders_sender_name_len
  check (sender_name is null or length(trim(sender_name)) between 1 and 160);

alter table public.orders drop constraint if exists orders_sender_phone_format;
alter table public.orders
  add constraint orders_sender_phone_format
  check (sender_phone is null or sender_phone ~ '^\+959[0-9]{7,9}$');

comment on column public.orders.source is
  'Where the order came from. portal = booked by the shop itself; the rest '
  'are Outside Way parcels typed up by the office from that channel.';
comment on column public.orders.sender_name is
  'Outside Way only: who sent the parcel, when it is filed under the house '
  'Direct shop rather than their own account.';

-- ----------------------------------------------------------------------------
-- 2. shops: the house Direct shop
-- ----------------------------------------------------------------------------
alter table public.shops
  add column if not exists is_direct boolean not null default false;

create unique index if not exists shops_one_direct
  on public.shops (is_direct) where is_direct;

comment on column public.shops.is_direct is
  'The office''s house shop for Outside Way parcels from senders with no '
  'account. At most one row; only the office may set it.';

create or replace function public.tg_shops_direct_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_service_ctx() or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' and new.is_direct then
    raise exception 'shop_direct_forbidden' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.is_direct is distinct from old.is_direct then
    raise exception 'shop_direct_forbidden' using errcode = '42501';
  end if;

  return new;
end $$;

comment on function public.tg_shops_direct_guard is
  'Only the office may flag or unflag the house Direct shop. A shop owner who '
  'could set it on their own shop would receive every direct sender''s COD.';

drop trigger if exists shops_direct_guard on public.shops;
create trigger shops_direct_guard before insert or update on public.shops
for each row execute function public.tg_shops_direct_guard();
