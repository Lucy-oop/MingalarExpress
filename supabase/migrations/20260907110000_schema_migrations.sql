-- ============================================================================
--  MINGALAR EXPRESS  ·  0030 — A LEDGER OF WHAT HAS BEEN APPLIED
--
--  Until now nothing recorded which migrations a database had. `db-push.sh`
--  could only ask "does public.profiles exist?", which answers "migrated at
--  all" and not "migrated to where" -- so against a live project it refused
--  outright and its own message told you to apply the newer files by hand,
--  one psql invocation each, getting the order right yourself. That worked for
--  three files. It does not scale, and the failure mode is a half-applied
--  function nobody notices.
--
--  This is the table that makes the next push one safe command.
--
--  ---------------------------------------------------------------------------
--  WHY THE HISTORY IS A LITERAL LIST
--
--  Every migration up to and including this one is inserted below by name. It
--  has to be a list rather than "assume everything before me ran", because a
--  partially-migrated database would then be recorded as complete and the
--  missing files skipped forever -- the exact error a ledger exists to stop.
--
--  A fresh database applies these files in order anyway and the push script
--  records each as it goes; the insert is `on conflict do nothing` so the two
--  paths agree.
--
--  ---------------------------------------------------------------------------
--  THE CHECKSUM IS ADVISORY BUT IT HAS ALREADY EARNED ITS PLACE
--
--  An applied migration is history and editing one makes the repo and the
--  database disagree in a way nothing else can see. That happened in this repo
--  a week ago: 0026 was amended after being written, and it was only safe
--  because it had not been pushed yet. The push script compares the file's md5
--  to what was recorded and stops rather than guessing.
--
--  Backfilled as NULL here, because this migration cannot know what the files
--  looked like when they ran. Nulls are simply not compared.
--
--  Forward-only.
-- ============================================================================

create table if not exists public.schema_migrations (
  filename   text primary key,
  applied_at timestamptz not null default now(),
  -- md5 of the file as applied. NULL for anything backfilled by this migration.
  checksum   text
);

comment on table public.schema_migrations is
  'Which migration files have been applied. Written by scripts/db-push.sh, '
  'never by the application. Rows are history: an entry is not edited or '
  'removed, and a checksum mismatch means the file changed after it ran.';

/*
  RLS ON, WITH NO POLICIES, which is the strongest setting available and the
  right one here: deployment metadata that nothing in the product has any
  business reading. No policy means no row matches for anyone, and the grants
  are revoked as well, so PostgREST cannot see the table at all. The service
  role and SQL sessions bypass RLS, which is precisely who does need it.

  It is also not optional. rls_smoke asserts that every table in `public` has
  RLS enabled -- described in that file as "the one assertion that notices a
  table shipped without RLS being considered at all" -- and it caught this table
  the first time it ran. Exempting a table because it feels harmless is how the
  invariant stops meaning anything.
*/
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;

insert into public.schema_migrations (filename, applied_at, checksum)
select f, now(), null
  from (values
    ('20260825090100_init.sql'),
    ('20260825090200_triggers_rpc.sql'),
    ('20260825090300_rls.sql'),
    ('20260825090400_storage.sql'),
    ('20260825090500_offers_realtime.sql'),
    ('20260825090600_settlement_admin.sql'),
    ('20260825090700_routes.sql'),
    ('20260825090800_trips_rpc.sql'),
    ('20260825090900_retire_offer_engine.sql'),
    ('20260901090100_shop_panel.sql'),
    ('20260902090100_failed_parcel_resolution.sql'),
    ('20260903090100_returned_status.sql'),
    ('20260903090200_return_leg.sql'),
    ('20260903090300_notification_outbox.sql'),
    ('20260903090400_trip_rider_matches_orders.sql'),
    ('20260903090500_drop_notification_outbox.sql'),
    ('20260903090600_order_notes.sql'),
    ('20260903090700_collection_vs_delivery_attempts.sql'),
    ('20260903090800_rider_pickup_count.sql'),
    ('20260903090900_kpay_status.sql'),
    ('20260903091000_kpay_verification.sql'),
    ('20260903091100_unreceived_cod.sql'),
    ('20260903091200_policy_acceptance.sql'),
    ('20260903091300_public_settings.sql'),
    ('20260903091400_rider_collection.sql'),
    ('20260903091500_shop_approval.sql'),
    ('20260907090000_hub_held_pickups.sql'),
    ('20260907093000_collect_before_deliver.sql'),
    ('20260907100000_collection_not_deliverable.sql'),
    -- this file itself: it is applied by the time these rows land
    ('20260907110000_schema_migrations.sql')
  ) as v(f)
on conflict (filename) do nothing;
