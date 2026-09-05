-- ============================================================================
--  MINGALAR EXPRESS  ·  0026 — A SHOP DESCRIBES ITSELF, THE OFFICE SAYS YES
--
--  A shop signs up, fills in its own name, what it sells, its phone and its
--  pickup address, and waits. The office reads it and clicks once. Nobody in
--  the office retypes an address the shop already knows.
--
--  ---------------------------------------------------------------------------
--  THE BUG THIS FIXES, WHICH IS LIVE TODAY
--
--  `shops_owner_all` is `for all` with `owner_id = auth.uid()`, and
--  `authenticated` holds an UPDATE grant on `is_active`. So:
--
--      office:  update shops set is_active = false   -- suspended
--      owner:   update shops set is_active = true    -- un-suspended
--
--  A suspended shop can turn itself back on. Reproduced against this schema
--  before writing this migration.
--
--  `profiles` has never had that problem: `tg_profiles_guard` refuses any
--  non-admin change to `role` or `is_active`, which is why a shop owner cannot
--  promote themselves to super_admin. `shops` simply never got the equivalent
--  trigger. This adds it, mirroring that one.
--
--  It matters more now than it did an hour ago: an approval flag an owner can
--  write is not an approval flag.
--
--  ---------------------------------------------------------------------------
--  WHY approved_at AND NOT is_active
--
--  "Never approved" and "we switched it off" are different facts and the office
--  queue has to tell them apart. is_active keeps meaning suspension; approval is
--  its own timestamp, and a shop is usable only when both agree.
--
--  Forward-only.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. What a shop tells us about itself, and what the office decides
-- ----------------------------------------------------------------------------

alter table public.shops
  -- Clause 1 of the COD Advance policy asks for ရောင်းချသည့်ပစ္စည်းအမျိုးအစား —
  -- the type of goods sold. Nullable, because every existing shop predates the
  -- question and none of them should break for not having answered it.
  add column if not exists goods_type       text
    check (goods_type is null or length(trim(goods_type)) between 1 and 160),

  -- NULL means the office has not looked yet.
  add column if not exists approved_at      timestamptz,
  add column if not exists approved_by      uuid references public.profiles(id) on delete set null,

  add column if not exists rejected_at      timestamptz,
  add column if not exists rejection_reason text
    check (rejection_reason is null or length(trim(rejection_reason)) between 1 and 500);

comment on column public.shops.goods_type is
  'What the shop sells. Clause 1 of the COD advance policy requires it; the '
  'rest of that clause (NRC, shop page, bank account) waits until COD advance '
  'exists.';
comment on column public.shops.approved_at is
  'When the office let this shop start trading. NULL means it is still waiting. '
  'Distinct from is_active, which means suspended -- the queue has to tell '
  '"never approved" from "switched off".';

-- The office queue reads exactly this.
create index if not exists shops_awaiting_idx
  on public.shops (created_at) where approved_at is null and rejected_at is null;

-- ----------------------------------------------------------------------------
-- 2. GRANDFATHER
--
--  Every shop that exists today already earned its place, and a migration that
--  silently stops them trading is a migration that breaks a working morning.
-- ----------------------------------------------------------------------------

update public.shops
   set approved_at = created_at
 where approved_at is null and rejected_at is null;


-- ----------------------------------------------------------------------------
-- 3. THE GUARD — mirroring tg_profiles_guard
--
--  A shop owns its own description. It does not own the decision about itself.
--
--  BEFORE INSERT matters as much as BEFORE UPDATE: the setup step inserts under
--  the OWNER's session (shops_owner_all permits it, which is what removes the
--  office's data entry), so without this an owner could arrive pre-approved.
-- ----------------------------------------------------------------------------

create or replace function public.tg_shops_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The service role and SQL sessions are the office by definition; seeds and
  -- migrations run here.
  if public.is_service_ctx() then return new; end if;

  if tg_op = 'INSERT' then
    if not public.is_admin() then
      -- A shop describes itself into existence unapproved, whatever it sent.
      new.approved_at      := null;
      new.approved_by      := null;
      new.rejected_at      := null;
      new.rejection_reason := null;
      new.is_active        := true;   -- not suspended; simply not yet approved
    end if;
    return new;
  end if;

  if not public.is_admin() then
    if new.is_active    is distinct from old.is_active
    or new.approved_at  is distinct from old.approved_at
    or new.approved_by  is distinct from old.approved_by
    or new.rejected_at  is distinct from old.rejected_at
    or new.owner_id     is distinct from old.owner_id then
      raise exception 'shop_decision_forbidden'
        using errcode = '42501',
              hint = 'A shop may change its own details, not its approval, '
                     'its suspension or its owner. Those are the office''s.';
    end if;
    return new;
  end if;

  -- An admin may do all of it, and it is written down.
  if new.is_active   is distinct from old.is_active
  or new.approved_at is distinct from old.approved_at
  or new.rejected_at is distinct from old.rejected_at then
    perform public.write_audit('shop.decision', 'shops', old.id::text,
      jsonb_build_object('is_active', old.is_active,
                         'approved_at', old.approved_at,
                         'rejected_at', old.rejected_at),
      jsonb_build_object('is_active', new.is_active,
                         'approved_at', new.approved_at,
                         'rejected_at', new.rejected_at,
                         'reason', new.rejection_reason));
  end if;
  return new;
end $$;

comment on function public.tg_shops_guard is
  'A shop owns its description, not the decision about itself. Mirrors '
  'tg_profiles_guard. Before this existed, a suspended shop could run one '
  'UPDATE and un-suspend itself.';

drop trigger if exists shops_guard on public.shops;
create trigger shops_guard before insert or update on public.shops
for each row execute function public.tg_shops_guard();
