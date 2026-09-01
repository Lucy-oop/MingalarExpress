-- ============================================================================
--  MINGALAR EXPRESS  ·  0003 — ROW LEVEL SECURITY
--
--  Deny by default on every table, then grant the narrowest workable policy per
--  role. The invariants this file exists to enforce:
--
--    * A shop sees its own orders and nothing else. Not other shops' orders,
--      not rider profiles, not the ledger.
--    * A rider sees their assigned work, live offers, and their own money.
--      They cannot see another rider's location or earnings.
--    * A rider cannot change their own commission, capacity or base area
--      (tg_riders_guard) nor their own role (tg_profiles_guard).
--    * order_status_events, cod_ledger and audit_log are append-only or
--      read-only from every client role. No UPDATE/DELETE policy exists, so
--      no UPDATE/DELETE is possible -- including by super_admin.
--    * Middleware is a UX gate. THIS is the security boundary.
-- ============================================================================

alter table public.profiles            enable row level security;
alter table public.service_areas       enable row level security;
alter table public.shops               enable row level security;
alter table public.rider_profiles      enable row level security;
alter table public.orders              enable row level security;
alter table public.order_status_events enable row level security;
alter table public.order_assignments   enable row level security;
alter table public.cod_ledger          enable row level security;
alter table public.settlements         enable row level security;
alter table public.app_settings        enable row level security;
alter table public.audit_log           enable row level security;


-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------

create policy profiles_read_self_or_dispatch on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_dispatch());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Rows normally arrive via the auth signup trigger (definer, bypasses RLS).
-- This covers Super Admin creating a profile ahead of an invite.
create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (public.is_admin());

-- No DELETE policy: profiles die with their auth.users row (ON DELETE CASCADE).


-- ----------------------------------------------------------------------------
-- service_areas  — reference data: everyone reads, admin writes
-- ----------------------------------------------------------------------------

create policy areas_read_all on public.service_areas
  for select to authenticated using (true);

create policy areas_write_admin on public.service_areas
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ----------------------------------------------------------------------------
-- shops
-- ----------------------------------------------------------------------------

create policy shops_owner_all on public.shops
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy shops_read_dispatch on public.shops
  for select to authenticated
  using (public.is_dispatch());

create policy shops_write_admin on public.shops
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A rider sees a shop's name, phone and pickup point only while carrying work
-- for it. Definer helper, so this does not nest an RLS read of orders.
create policy shops_read_rider_with_work on public.shops
  for select to authenticated
  using (public.rider_has_work_at_shop(id));


-- ----------------------------------------------------------------------------
-- rider_profiles
--
--  Column-level protection is enforced by tg_riders_guard, NOT by column
--  privileges -- see the note in 0002 §3.
-- ----------------------------------------------------------------------------

create policy riders_read_self on public.rider_profiles
  for select to authenticated using (id = auth.uid());

create policy riders_update_self on public.rider_profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy riders_read_dispatch on public.rider_profiles
  for select to authenticated using (public.is_dispatch());

create policy riders_write_admin on public.rider_profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ----------------------------------------------------------------------------
-- orders
-- ----------------------------------------------------------------------------

-- Shop: reads its own, creates pending ones, may cancel only while pending.
create policy orders_read_shop on public.orders
  for select to authenticated
  using (public.owns_shop(shop_id));

create policy orders_insert_shop on public.orders
  for insert to authenticated
  with check (
    public.owns_shop(shop_id)
    and created_by = auth.uid()
    and status     = 'pending'
    and rider_id   is null
    -- a shop cannot pre-award itself a commission split
    and rider_commission_amount is null
    and platform_fee_amount     is null
  );

create policy orders_update_shop on public.orders
  for update to authenticated
  using (public.owns_shop(shop_id) and status = 'pending')
  with check (public.owns_shop(shop_id) and status in ('pending','cancelled'));

-- Rider: reads assigned work plus any live offer aimed at them.
create policy orders_read_rider on public.orders
  for select to authenticated
  using (
    rider_id = auth.uid()
    or exists (
      select 1 from public.order_assignments a
       where a.order_id = orders.id
         and a.rider_id = auth.uid()
         and a.response = 'pending'
         and a.expires_at > now()
    )
  );

-- Rider UPDATE is belt-and-braces: real transitions go through advance_order().
-- Scoped so a rider can only ever touch an order that is currently theirs.
create policy orders_update_rider on public.orders
  for update to authenticated
  using (rider_id = auth.uid() and status in ('assigned','picked_up'))
  with check (rider_id = auth.uid());

-- Dispatch / admin: full control.
create policy orders_all_dispatch on public.orders
  for all to authenticated
  using (public.is_dispatch()) with check (public.is_dispatch());


-- ----------------------------------------------------------------------------
-- order_status_events  — READ ONLY for every client role.
--  Writes happen exclusively inside tg_orders_audit (SECURITY DEFINER, runs as
--  the table owner, which bypasses RLS). No insert/update/delete policy exists
--  and none should be added.
-- ----------------------------------------------------------------------------

create policy ose_read on public.order_status_events
  for select to authenticated
  using (
    public.is_dispatch()
    or exists (
      select 1 from public.orders o
       where o.id = order_status_events.order_id
         and (public.owns_shop(o.shop_id) or o.rider_id = auth.uid())
    )
  );


-- ----------------------------------------------------------------------------
-- order_assignments
-- ----------------------------------------------------------------------------

create policy oa_read_own_or_dispatch on public.order_assignments
  for select to authenticated
  using (rider_id = auth.uid() or public.is_dispatch());

-- A rider may accept or reject an offer aimed at them, while it is still live.
create policy oa_respond_rider on public.order_assignments
  for update to authenticated
  using (rider_id = auth.uid() and response = 'pending' and expires_at > now())
  with check (rider_id = auth.uid() and response in ('accepted','rejected'));

create policy oa_write_dispatch on public.order_assignments
  for all to authenticated
  using (public.is_dispatch()) with check (public.is_dispatch());


-- ----------------------------------------------------------------------------
-- cod_ledger  — APPEND ONLY.
--  No UPDATE and no DELETE policy: a booked line is never edited, it is
--  reversed with an 'adjustment' line. This is the whole point of a ledger.
-- ----------------------------------------------------------------------------

create policy cod_read_own_or_dispatch on public.cod_ledger
  for select to authenticated
  using (rider_id = auth.uid() or public.is_dispatch());

-- Manual adjustments / cash remittance only. The automatic cod_collected and
-- commission_earned lines are written by the definer trigger.
create policy cod_insert_admin on public.cod_ledger
  for insert to authenticated
  with check (
    public.is_admin()
    and kind in ('cod_remitted','adjustment','platform_fee')
    and created_by = auth.uid()
  );


-- ----------------------------------------------------------------------------
-- settlements
-- ----------------------------------------------------------------------------

create policy stl_read_own_or_dispatch on public.settlements
  for select to authenticated
  using (rider_id = auth.uid() or public.is_dispatch());

create policy stl_write_admin on public.settlements
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ----------------------------------------------------------------------------
-- app_settings  — everyone reads (fee quoting, map config), admin writes.
--  No INSERT policy: the singleton row is seeded in 0001 and the CHECK (id)
--  makes a second row impossible anyway.
-- ----------------------------------------------------------------------------

create policy settings_read_all on public.app_settings
  for select to authenticated using (true);

create policy settings_update_admin on public.app_settings
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ----------------------------------------------------------------------------
-- audit_log  — read: admin only. write: definer functions only.
-- ----------------------------------------------------------------------------

create policy audit_read_admin on public.audit_log
  for select to authenticated using (public.is_admin());


-- ============================================================================
--  IMMUTABILITY: TABLE-LEVEL REVOKES
--
--  RLS alone is not enough here. With no matching policy, INSERT raises 42501
--  but UPDATE and DELETE simply match zero rows and report success -- a silent
--  no-op. For a ledger that is the wrong failure mode: an app (or an operator
--  in the SQL editor) would believe an edit landed.
--
--  Revoking the privilege outright makes the attempt error loudly. Unlike the
--  rider_profiles case in 0002 -- where column privileges would have locked out
--  Super Admins too -- here we genuinely want NOBODY holding an end-user JWT to
--  mutate these rows, admins included. Corrections are made by booking a
--  reversing 'adjustment' line, never by editing history.
--
--  Definer triggers are unaffected: they execute as the table owner.
--  service_role keeps its grants from 0001 (trusted backend / migrations).
-- ============================================================================

revoke update, delete         on public.cod_ledger          from authenticated;
revoke insert, update, delete on public.order_status_events from authenticated;
revoke insert, update, delete on public.audit_log           from authenticated;

-- Orders are cancelled, never deleted -- the checkpoint trail must outlive them.
revoke delete on public.orders   from authenticated;
revoke delete on public.profiles from authenticated;
revoke delete on public.shops    from authenticated;

-- The settings singleton is seeded once and only ever updated.
revoke insert, delete on public.app_settings from authenticated;

-- Settlements are locked by status, not deleted.
revoke delete on public.settlements from authenticated;
