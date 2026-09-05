-- ============================================================================
--  MINGALAR EXPRESS  ·  0023 — POLICY ACCEPTANCE
--
--  The COD Advance Settlement Policy is not a notice. It says the shop carries
--  the loss when a parcel turns out to hold a rock (clause 6), that advanced COD
--  is not the shop's money until the customer actually pays (clause 8), and that
--  the office may suspend the service without warning (clause 10). Terms like
--  that are worth nothing unless you can say, later, who agreed to them and
--  when.
--
--  So: one row per person per version, written the moment they accept.
--
--  WHY VERSIONED. Terms that carry liability change, and an acceptance of the
--  September text is not an acceptance of whatever replaces it. Bumping
--  COD_ADVANCE_POLICY_VERSION in lib/legal/cod-advance.ts re-asks everybody,
--  which is the only honest way to change an agreement. The unique key makes
--  re-accepting the SAME version a no-op rather than a duplicate.
--
--  WHY APPEND-ONLY. Same reason as cod_ledger and order_notes: a record that can
--  be edited is not evidence. There is no UPDATE and no DELETE policy, so there
--  is nothing to enforce -- the permission simply does not exist, for anyone,
--  including the person who wrote the row and including the office.
--
--  WHY profile_id AND NOT shop_id. A person accepts an agreement, not a
--  business. It is also the only id available at the moment it matters: a shop
--  owner signs up before the office has created their shop row, so a shop_id
--  here would sometimes be null on the very account we most want a record for.
--
--  WHY GENERIC. `policy_key` rather than a cod_advance_accepted_at column on
--  profiles, because there will be a second document -- rider terms, a privacy
--  notice -- and each would otherwise be another column and another migration.
--
--  Forward-only.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. The record
-- ----------------------------------------------------------------------------

create table if not exists public.policy_acceptances (
  id          uuid primary key default gen_random_uuid(),

  -- CASCADE: if the account is gone there is nobody left to hold to the terms,
  -- and keeping an orphan row would be keeping a name we can no longer resolve.
  profile_id  uuid not null references public.profiles(id) on delete cascade,

  -- Which document. 'cod_advance' today; free text so a second one needs no
  -- migration, bounded so it cannot become a paragraph.
  policy_key  text not null check (length(trim(policy_key)) between 1 and 60),

  -- Which wording of it. A date string in practice ('2026-09-05'), but text
  -- rather than date so the scheme can change without a column type change.
  version     text not null check (length(trim(version)) between 1 and 40),

  accepted_at timestamptz not null default now(),

  -- Accepting the same version twice is the same fact, not two facts. This also
  -- lets the insert be a plain `on conflict do nothing` from the app.
  constraint policy_acceptances_once unique (profile_id, policy_key, version)
);

-- The only read the app makes: "has this person accepted this document, and
-- which version". Newest first so the latest is the first row.
create index if not exists policy_acceptances_lookup_idx
  on public.policy_acceptances (profile_id, policy_key, accepted_at desc);

comment on table public.policy_acceptances is
  'Append-only record of who accepted which version of which policy, and when. '
  'No UPDATE or DELETE policy exists: a record that can be edited is not '
  'evidence. See lib/legal/ for the documents themselves.';
comment on column public.policy_acceptances.version is
  'The wording accepted. Bumping the version in lib/legal re-asks every user, '
  'because an acceptance of the old text is not an acceptance of the new one.';


-- ----------------------------------------------------------------------------
-- 2. RLS
--
--  SELECT and INSERT only, and the absence of the other two is the whole point.
--
--  `profile_id = auth.uid()` appears in the WITH CHECK as well as the USING,
--  and that is the load-bearing clause: without it any signed-in user could
--  file an acceptance in somebody else's name, which is precisely the forgery
--  an evidence table exists to prevent. The app never sends a profile_id.
--
--  Dispatch and admin read everything, because the office is who needs to
--  answer "did they agree to clause 6" when a parcel turns out to hold a rock.
--  They cannot write one: an acceptance the office can create on your behalf is
--  not an acceptance.
-- ----------------------------------------------------------------------------

alter table public.policy_acceptances enable row level security;

drop policy if exists policy_acceptances_read_own on public.policy_acceptances;
create policy policy_acceptances_read_own on public.policy_acceptances
  for select to authenticated
  using (profile_id = auth.uid() or public.is_dispatch());

drop policy if exists policy_acceptances_insert_own on public.policy_acceptances;
create policy policy_acceptances_insert_own on public.policy_acceptances
  for insert to authenticated
  with check (profile_id = auth.uid());

grant select, insert on public.policy_acceptances to authenticated;
