-- ============================================================================
--  SCHEDULING THE OUTBOX DRAIN
--
--  NOT a migration. `pg_cron` and `pg_net` are per-project extensions and the
--  URL and secret differ per environment, so putting this in supabase/migrations
--  would either fail on a local stack that has neither, or bake a staging URL
--  into production. Run it by hand, once, per project, from the SQL editor.
--
--  What it does: every minute, POST to the drain route. The route claims what is
--  due, sends it, and settles each row. Nothing here knows about SMS.
--
--  ONE MINUTE IS THE FLOOR, not a target. Quiet hours mean a message raised at
--  21:40 waits until 07:00 regardless; the minute only bounds how late a daytime
--  message is. Almost all of these ticks will claim nothing and cost one empty
--  HTTP call.
-- ============================================================================

create extension if not exists pg_cron  with schema extensions;
create extension if not exists pg_net   with schema extensions;

-- ---------------------------------------------------------------------------
-- The secret. Must match NOTIFY_CRON_SECRET in the web app's environment.
--
-- Vault rather than a literal in the job command: cron.job is world-readable to
-- anyone who can reach the database, and the drain endpoint is the one thing
-- standing between a stranger and the platform's SMS bill.
-- ---------------------------------------------------------------------------
select vault.create_secret(
  'REPLACE_WITH_THE_SAME_VALUE_AS_NOTIFY_CRON_SECRET',
  'notify_cron_secret',
  'Bearer token for POST /api/notifications/drain');

select cron.unschedule('drain-notification-outbox')
 where exists (select 1 from cron.job where jobname = 'drain-notification-outbox');

select cron.schedule(
  'drain-notification-outbox',
  '* * * * *',
  $job$
  select net.http_post(
    url     := 'https://REPLACE_WITH_SITE_URL/api/notifications/drain',
    headers := jsonb_build_object(
                 'content-type',  'application/json',
                 'authorization', 'Bearer ' || (select decrypted_secret
                                                  from vault.decrypted_secrets
                                                 where name = 'notify_cron_secret')),
    body    := '{}'::jsonb,
    -- Shorter than the route's own budget. A tick that overruns is picked up by
    -- the next one; a tick that piles up is how a queue turns into an incident.
    timeout_milliseconds := 30000
  );
  $job$
);


-- ---------------------------------------------------------------------------
-- OPERATIONS
-- ---------------------------------------------------------------------------

-- Is it running?
--   select jobid, jobname, schedule, active from cron.job;
--   select status, start_time, return_message
--     from cron.job_run_details
--    where jobname = 'drain-notification-outbox'
--    order by start_time desc limit 20;

-- What did the endpoint actually answer? (pg_net replies land here, async.)
--   select id, status_code, content, created
--     from net._http_response order by created desc limit 20;

-- Anything stuck or given up on?
--   select id, event, status, attempts, send_after, last_error
--     from public.notification_outbox
--    where status in ('queued','sending','dead')
--    order by created_at desc limit 50;

-- Stop it (an incident, a bad template, a runaway bill):
--   select cron.unschedule('drain-notification-outbox');
-- Or leave cron alone and close the tap at the source:
--   update public.app_settings set notifications_enabled = false where id;
