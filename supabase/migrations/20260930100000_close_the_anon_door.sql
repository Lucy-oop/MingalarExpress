-- ============================================================================
-- 0054. CLOSE THE ANON DOOR
--
-- ----------------------------------------------------------------------------
-- THE HOLE, found in the cash-flow audit and confirmed on the verify database
--
-- 1. Every function in `public` kept Postgres's default grant: EXECUTE to
--    PUBLIC. Migrations revoked `anon` by name here and there, but a role
--    inherits PUBLIC's grants, so anon could still execute them:
--    remit_cod, build_settlement, mark_settlement_paid, confirm_kpay_payment,
--    cancel_trip, close_run_and_deposit, receive_trip_parcels, ...
--
-- 2. Their guards all accept `is_service_ctx()`, which was
--        select auth.uid() is null
--    -- "nobody is signed in". That is true of a migration or a cron job, and
--    equally true of an anonymous request. The anon key ships in the browser
--    bundle, so anyone could write off a rider's cash, mark a settlement paid
--    or confirm a KBZPay receipt without signing in.
--
-- 3. Separately, `orders_update_rider` let a rider UPDATE any column of their
--    own order while it was assigned or picked up -- cod_amount,
--    collected_via, the commission split. Every real rider transition goes
--    through advance_order (security definer); the app never updates orders as
--    a rider, so the policy was only ever a way round those rules.
--
-- ----------------------------------------------------------------------------
-- THE FIX
--
-- is_service_ctx() now asks WHICH ROLE the session is acting as, as well as
-- whether a user id is present. `current_setting('role')` is what SET ROLE set, and it
-- survives into security definer functions (current_user does not -- inside
-- one it is always the owner). PostgREST always SETs the role from the JWT:
--
--     direct SQL (migrations, cron, psql)   'none'          -> service
--     service_role key                      'service_role'  -> service
--     signed-in user                        'authenticated' -> not service
--     no or anon key                        'anon'          -> not service
--
-- Probed on mge-verify before writing this. The SQL test suites simulate users
-- with SET ROLE authenticated inside a postgres session, and read correctly
-- under this rule; a session_user check would have made them all "service".
--
-- EXECUTE is revoked from PUBLIC on every function, granted back to
-- authenticated and service_role, and to anon only on the two RPCs public
-- pages call: track_order (app/track/[code]) and public_settings
-- (lib/settings/public). Default privileges stop the next function reopening
-- it. Trigger functions are unaffected: EXECUTE is checked when a trigger is
-- created, not each time it fires.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. is_service_ctx: a role, not an absence
-- ----------------------------------------------------------------------------
create or replace function public.is_service_ctx()
returns boolean language sql stable set search_path = public
as $$
  -- BOTH conditions: a service role AND no signed-in user. The role check is
  -- what shuts out anon; keeping the old "no uid" check as well means a
  -- session that carries a user's JWT is never the service, whatever role it
  -- is acting as -- stricter than either test alone.
  select coalesce(nullif(current_setting('role', true), ''), 'none') in ('none', 'service_role')
     and auth.uid() is null
$$;

comment on function public.is_service_ctx is
  'True for direct SQL sessions (migrations, cron) and the service_role key; '
  'false for signed-in users AND for anonymous requests: the role must be a '
  'service role and no user may be signed in. Was only `auth.uid() is null`, '
  'which also admitted anon (0054).';

-- ----------------------------------------------------------------------------
-- 2. No function is callable by PUBLIC
-- ----------------------------------------------------------------------------
revoke execute on all functions in schema public from public;
grant execute on all functions in schema public to authenticated, service_role;

-- The public pages' two RPCs, and nothing else.
grant execute on function public.track_order(text) to anon;
grant execute on function public.public_settings() to anon;

-- Functions created after this migration start closed as well.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Riders change orders only through advance_order
-- ----------------------------------------------------------------------------
drop policy if exists orders_update_rider on public.orders;
