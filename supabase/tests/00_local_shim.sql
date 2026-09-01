-- ============================================================================
--  LOCAL VERIFICATION SHIM — NOT A MIGRATION. Never run against a real project.
--
--  The ghcr.io/supabase/postgres image already ships: the extensions/auth/
--  storage schemas, auth.users, auth.uid(), and the anon/authenticated/
--  service_role roles. What it does NOT ship is the storage-api service's own
--  migrations (storage.buckets, storage.objects, storage.foldername) -- those
--  are created by the storage container at boot. This file stands them up so
--  migration 0004 can be executed and asserted locally.
--
--  It also normalises auth.uid() to the two-source form used by a live project
--  (request.jwt.claim.sub, then request.jwt.claims->>'sub') so tests can set a
--  single GUC.
-- ============================================================================

create extension if not exists postgis  with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts,1) - 1];
end $$;

grant usage on schema storage to authenticated, anon, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

-- The DB image ships the *base* auth.users. In a live project GoTrue runs its
-- own migrations at boot and adds the columns below, which seed.sql uses. Add
-- them here so the seed stays production-shaped rather than being trimmed to
-- fit a bare container.
alter table auth.users
  add column if not exists email_confirmed_at     timestamptz,
  add column if not exists phone                  text,
  add column if not exists phone_confirmed_at     timestamptz,
  add column if not exists email_change_token_new     varchar(255),
  add column if not exists email_change_token_current varchar(255),
  add column if not exists phone_change               text,
  add column if not exists phone_change_token         varchar(255),
  add column if not exists reauthentication_token varchar(255),
  add column if not exists is_sso_user            boolean not null default false,
  add column if not exists is_anonymous           boolean not null default false,
  add column if not exists banned_until           timestamptz,
  add column if not exists deleted_at             timestamptz;

-- PostgREST builds its schema cache as the `authenticator` role. A provisioned
-- Supabase project already grants it USAGE on public; the bare DB image does
-- not, and without it every table and RPC is invisible over REST.
grant usage on schema public to authenticator;

-- When running the real storage-api container with DB_INSTALL_ROLES=false, its
-- own migrations skip the role grants that a provisioned Supabase project has.
-- Without these, every Storage call returns "permission denied for schema storage".
grant usage on schema storage to postgres, anon, authenticated, service_role;
grant all on all tables    in schema storage to postgres, anon, authenticated, service_role;
grant all on all sequences in schema storage to postgres, anon, authenticated, service_role;
grant all on all functions in schema storage to postgres, anon, authenticated, service_role;
