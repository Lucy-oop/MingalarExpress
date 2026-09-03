-- ============================================================================
--  MINGALAR EXPRESS  ·  0012 — THE `returned` STATUS  (enum value only)
--
--  This file contains ONE statement, and that is the whole point of it.
--
--  `ALTER TYPE ... ADD VALUE` cannot be followed by a USE of that value inside
--  the same transaction -- Postgres raises `unsafe use of new value`. Our own
--  harness applies migrations with `psql -f`, which is autocommit and would be
--  fine, but `supabase db push` drives staging and production and does not
--  promise the same. Splitting the value from its first use makes the question
--  moot rather than something to remember.
--
--  Same reason `trip_pay` was added in 0007 and first used in 0008. Everything
--  that reads or writes 'returned' lives in 0013.
--
--  Forward-only. Never wrap this file in BEGIN/COMMIT.
-- ============================================================================

alter type public.order_status add value if not exists 'returned';
