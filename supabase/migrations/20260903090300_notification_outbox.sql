-- ============================================================================
--  MINGALAR EXPRESS  ·  0014 — TELLING THE SHOP SOMETHING WENT WRONG
--
--  A parcel fails. The shop finds out when it happens to open the dashboard --
--  which for most shops is the next morning, or the day after. Migration 0011
--  gave them three ways to answer (retry / return / cancel) and 0013 gave the
--  return a real leg to travel on, but nothing anywhere asks the question.
--
--  This is the ask. Two messages, no more:
--
--    parcel_failed   an attempt failed and the shop can still change course
--    parcel_held     the attempt ceiling is reached; we have stopped trying
--
--  DESIGN NOTES worth keeping.
--
--  1. OUTBOX, NOT A GATEWAY CALL. Nothing here talks to an SMS provider. The
--     trigger writes a row inside the same transaction as the failure, so the
--     two cannot disagree: if the parcel failed, the message exists; if the
--     transaction rolls back, so does the message. A gateway timeout can never
--     roll back a rider's delivery.
--
--  2. ONE ROW PER FAILED ATTEMPT, and the two events are mutually exclusive.
--     Whether we have given up is knowable at the moment of failure -- it is
--     just `attempts >= max_delivery_attempts` -- so the trigger picks the event
--     then. close_trip enqueues nothing. That is deliberate: an earlier sketch
--     had close_trip send a second "we have stopped" message minutes after the
--     failure message, which is two SMS the platform pays for to say one thing.
--
--  3. THE MESSAGE BODY IS NOT IN HERE. The row carries `event`, `lang` and a
--     `payload`; the worker renders it. Burmese template strings inside a
--     migration would be unreachable from the unit tests and a nightmare to
--     change. See lib/notifications/messages.ts.
--
--  4. QUIET HOURS ARE COMPUTED AT ENQUEUE, not at send. `send_after` is stamped
--     once, when we know what time it is, so the worker stays a dumb loop with
--     no clock logic to get wrong on the boundary. A parcel that fails at 21:40
--     is a message that leaves at 07:00.
--
--  5. NO CUSTOMER MESSAGES. Shops only, for now. The recipient is the shop desk
--     phone, falling back to the owner's own.
--
--  Forward-only.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. Settings
--
--  Hours rather than a `time`, because the only thing anyone will ever want to
--  change is "start an hour earlier". Equal values disable the window entirely,
--  which is how staging runs without waiting until morning.
-- ----------------------------------------------------------------------------

alter table public.app_settings
  add column if not exists notifications_enabled boolean not null default true,
  add column if not exists notify_quiet_from     smallint not null default 21
    check (notify_quiet_from between 0 and 23),
  add column if not exists notify_quiet_until    smallint not null default 7
    check (notify_quiet_until between 0 and 23),
  add column if not exists notify_max_attempts   smallint not null default 5
    check (notify_max_attempts between 1 and 10);

comment on column public.app_settings.notifications_enabled is
  'Master switch. FALSE stops anything being enqueued at all -- the kill switch '
  'for a runaway gateway bill or a bad template.';
comment on column public.app_settings.notify_quiet_from is
  'Yangon-local hour the quiet window opens (21 = 9 PM). Messages raised inside '
  'the window are queued until notify_quiet_until. Set equal to disable.';
comment on column public.app_settings.notify_max_attempts is
  'Send attempts before a message is dead-lettered. Not the same thing as '
  'max_delivery_attempts, which counts attempts to deliver the parcel.';


-- ----------------------------------------------------------------------------
-- 2. notify_send_after — the quiet-hours calculation
--
--  Returns the earliest moment a message raised at p_at may be sent. The window
--  is allowed to wrap midnight, which the interesting one (21 -> 7) does.
-- ----------------------------------------------------------------------------

create or replace function public.notify_send_after(p_at timestamptz default now())
returns timestamptz
language plpgsql stable set search_path = public
as $$
declare
  v_from  smallint;
  v_until smallint;
  v_local timestamp;
  v_hour  smallint;
  v_day   date;
  v_quiet boolean;
begin
  select s.notify_quiet_from, s.notify_quiet_until
    into v_from, v_until
    from public.app_settings s where s.id;

  v_from  := coalesce(v_from, 21);
  v_until := coalesce(v_until, 7);

  -- No window configured. Send now.
  if v_from = v_until then
    return p_at;
  end if;

  v_local := p_at at time zone 'Asia/Yangon';
  v_hour  := extract(hour from v_local)::smallint;
  v_day   := v_local::date;

  v_quiet := case
               when v_from < v_until then v_hour >= v_from and v_hour < v_until
               else v_hour >= v_from or v_hour < v_until      -- wraps midnight
             end;

  if not v_quiet then
    return p_at;
  end if;

  -- Wake at v_until o'clock: today if we are past midnight already (03:00 in a
  -- 21->7 window), tomorrow otherwise (22:00 in the same window).
  if v_hour < v_until then
    return (v_day + make_interval(hours => v_until))::timestamp at time zone 'Asia/Yangon';
  else
    return ((v_day + 1) + make_interval(hours => v_until))::timestamp at time zone 'Asia/Yangon';
  end if;
end $$;

comment on function public.notify_send_after is
  'Earliest send time for a message raised at p_at, honouring the Yangon-local '
  'quiet window in app_settings. Applied at enqueue AND on every retry backoff.';


-- ----------------------------------------------------------------------------
-- 3. The outbox
-- ----------------------------------------------------------------------------

create table if not exists public.notification_outbox (
  id                   bigserial primary key,

  event                text not null
                         check (event in ('parcel_failed','parcel_held')),
  -- Viber is the planned second channel. It is in the CHECK now so that adding
  -- it later is a provider and a template, not a migration on a hot table.
  channel              text not null default 'sms'
                         check (channel in ('sms','viber')),

  order_id             uuid references public.orders(id)   on delete cascade,
  shop_id              uuid references public.shops(id)    on delete cascade,
  recipient_profile_id uuid references public.profiles(id) on delete set null,

  -- Nullable on purpose. A shop we cannot reach must show up as a dead row
  -- somebody can look at, not as a message that was quietly never created.
  to_phone             text check (to_phone is null or to_phone ~ '^\+959[0-9]{7,9}$'),
  lang                 text not null default 'my' check (lang in ('my','en')),

  -- Everything the renderer needs, snapshotted. A message about "attempt 2 of 3"
  -- must still say 2 of 3 after somebody raises the ceiling to 5.
  payload              jsonb not null default '{}'::jsonb,

  -- One row per (order, event, attempt). close_trip can run twice, a retry can
  -- re-enter the trigger; neither may cost a second SMS.
  dedupe_key           text not null unique,

  status               text not null default 'queued'
                         check (status in ('queued','sending','sent','dead')),
  attempts             smallint not null default 0,
  send_after           timestamptz not null default now(),
  claimed_at           timestamptz,
  sent_at              timestamptz,

  provider             text,
  provider_message_id  text,
  last_error           text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- There is no `failed` state. A retryable failure goes back to `queued` with a
-- later send_after, so the worker's claim query never has to know about retries
-- at all; a permanent one goes to `dead`. Four states, one of which is terminal
-- and one of which is a lock.
comment on column public.notification_outbox.status is
  'queued (due at send_after) -> sending (claimed) -> sent | dead. A retryable '
  'gateway error returns the row to queued with a backed-off send_after.';

comment on column public.notification_outbox.dedupe_key is
  'order:<uuid>:<event>:<attempt no>. Unique, so re-entering the enqueue path '
  'for the same real-world event is a no-op rather than a second message.';

create index if not exists notification_outbox_due_idx
  on public.notification_outbox (send_after)
  where status in ('queued','sending');

create index if not exists notification_outbox_order_idx
  on public.notification_outbox (order_id, created_at desc);

create index if not exists notification_outbox_dead_idx
  on public.notification_outbox (created_at desc)
  where status = 'dead';

drop trigger if exists notification_outbox_touch on public.notification_outbox;
create trigger notification_outbox_touch before update on public.notification_outbox
for each row execute function public.tg_touch_updated_at();

comment on table public.notification_outbox is
  'Messages owed to shops. Written in the same transaction as the event that '
  'caused them; drained by a worker that never runs inside that transaction.';


-- ----------------------------------------------------------------------------
-- 4. RLS
--
--  Read-only, and only for the office -- this is where a "did they ever tell
--  me?" support call gets answered. There is deliberately no INSERT, UPDATE or
--  DELETE policy: every write goes through the definer functions below or the
--  service role. A shop cannot read its own messages yet; when that screen
--  exists the policy is `owns_shop(shop_id)` and nothing else changes.
-- ----------------------------------------------------------------------------

alter table public.notification_outbox enable row level security;

drop policy if exists notification_outbox_read_dispatch on public.notification_outbox;
create policy notification_outbox_read_dispatch on public.notification_outbox
  for select to authenticated
  using (public.is_dispatch());


-- ----------------------------------------------------------------------------
-- 5. enqueue_notification
--
--  Definer, because the trigger that calls it runs for a rider finishing a
--  delivery and a rider can read neither shops nor profiles.
--
--  Returns the row id, or NULL when nothing was written -- notifications are
--  switched off, or this exact message already exists.
-- ----------------------------------------------------------------------------

create or replace function public.enqueue_notification(
  p_event      text,
  p_order_id   uuid,
  p_dedupe_key text,
  p_payload    jsonb default '{}'::jsonb
) returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  v_on      boolean;
  v_shop_id uuid;
  v_owner   uuid;
  v_phone   text;
  v_lang    text;
  v_id      bigint;
begin
  select s.notifications_enabled into v_on from public.app_settings s where s.id;
  if not coalesce(v_on, true) then
    return null;
  end if;

  select o.shop_id into v_shop_id from public.orders o where o.id = p_order_id;
  if v_shop_id is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  -- The shop desk phone is the operational number; the owner's own is the
  -- safety net for when the desk is unstaffed or the column is one day nullable.
  select sh.owner_id, coalesce(sh.phone, p.phone), coalesce(p.preferred_lang, 'my')
    into v_owner, v_phone, v_lang
    from public.shops sh
    left join public.profiles p on p.id = sh.owner_id
   where sh.id = v_shop_id;

  insert into public.notification_outbox (
    event, order_id, shop_id, recipient_profile_id, to_phone, lang,
    payload, dedupe_key, status, send_after, last_error)
  values (
    p_event, p_order_id, v_shop_id, v_owner, v_phone, v_lang,
    coalesce(p_payload, '{}'::jsonb), p_dedupe_key,
    case when v_phone is null then 'dead' else 'queued' end,
    public.notify_send_after(now()),
    case when v_phone is null then 'no_recipient_phone' end)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end $$;

comment on function public.enqueue_notification is
  'Writes one outbox row, resolving recipient, language and quiet hours. '
  'Idempotent on dedupe_key. Returns NULL when notifications are off or the '
  'message already exists.';


-- ----------------------------------------------------------------------------
-- 6. tg_orders_notify — the only enqueue point
--
--  ORDERING MATTERS. Same-timing triggers fire in name order, and `orders_audit`
--  sorts before `orders_notify`; that is what guarantees this failure's row is
--  already in order_status_events when order_attempt_count() reads it. Rename
--  either trigger and the attempt number in every message goes one too low.
-- ----------------------------------------------------------------------------

create or replace function public.tg_orders_notify()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_attempts integer;
  v_max      smallint;
  v_event    text;
begin
  -- The moment of failure, and only that. A row touched while already `failed`
  -- (close_trip detaching it, say) is not a new attempt.
  if new.status <> 'failed' or old.status is not distinct from 'failed'::public.order_status then
    return null;
  end if;

  -- The shop has already said retry / return / cancel. There is no decision to
  -- ask for, and a failed return leg is not news the shop can act on.
  if new.resolution is not null then
    return null;
  end if;

  select s.max_delivery_attempts into v_max from public.app_settings s where s.id;
  v_attempts := public.order_attempt_count(new.id);

  -- Mutually exclusive, decided here rather than at close_trip: see note 2.
  v_event := case
               when v_attempts >= coalesce(v_max, 3) then 'parcel_held'
               else 'parcel_failed'
             end;

  perform public.enqueue_notification(
    v_event,
    new.id,
    format('order:%s:%s:%s', new.id, v_event, v_attempts),
    jsonb_build_object(
      'code',           new.code,
      'customer_name',  new.customer_name,
      'attempt',        v_attempts,
      'max_attempts',   coalesce(v_max, 3),
      'fail_reason',    new.fail_reason,
      'cod_amount',     new.cod_amount,
      'payment_method', new.payment_method));

  return null;
end $$;

drop trigger if exists orders_notify on public.orders;
create trigger orders_notify after update on public.orders
for each row execute function public.tg_orders_notify();

comment on function public.tg_orders_notify is
  'Enqueues exactly one message per failed delivery attempt: parcel_held once '
  'the attempt ceiling is reached, parcel_failed below it. Silent when the shop '
  'has already resolved the parcel.';


-- ----------------------------------------------------------------------------
-- 7. The worker's three verbs
--
--  Service context only. These are not user actions and nothing in the app
--  calls them with a session.
-- ----------------------------------------------------------------------------

create or replace function public.claim_notifications(p_limit integer default 20)
returns setof public.notification_outbox
language plpgsql security definer
set search_path = public
as $$
begin
  if not (public.is_service_ctx() or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with due as (
    select o.id
      from public.notification_outbox o
     where (o.status = 'queued'  and o.send_after <= now())
        -- A worker that died mid-send left the row locked. Take it back rather
        -- than lose the message forever.
        or (o.status = 'sending' and o.claimed_at < now() - interval '5 minutes')
     order by o.send_after
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  )
  update public.notification_outbox o
     set status     = 'sending',
         claimed_at = now(),
         -- Counted at CLAIM, not at failure, so a worker that crashes hard
         -- still burns an attempt and the retry ceiling actually binds.
         attempts   = o.attempts + 1
    from due
   where o.id = due.id
  returning o.*;
end $$;

create or replace function public.complete_notification(
  p_id         bigint,
  p_provider   text,
  p_message_id text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not (public.is_service_ctx() or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.notification_outbox
     set status              = 'sent',
         sent_at             = now(),
         provider            = p_provider,
         provider_message_id = p_message_id,
         last_error          = null,
         claimed_at          = null
   where id = p_id;
end $$;

create or replace function public.fail_notification(
  p_id        bigint,
  p_error     text,
  p_retryable boolean default true
) returns public.notification_outbox
language plpgsql security definer
set search_path = public
as $$
declare
  v_row public.notification_outbox;
  v_max smallint;
begin
  if not (public.is_service_ctx() or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select s.notify_max_attempts into v_max from public.app_settings s where s.id;

  update public.notification_outbox o
     set last_error = left(coalesce(p_error, 'unknown'), 500),
         status     = case
                        -- "Invalid number" must not burn five attempts and a
                        -- week of backoff. The provider says which it is.
                        when not coalesce(p_retryable, true)        then 'dead'
                        when o.attempts >= coalesce(v_max, 5)       then 'dead'
                        else 'queued'
                      end,
         -- 1, 4, 16, 64, 256 minutes -- then re-clamped into working hours, so
         -- a 20:59 failure backing off an hour does not fire at 22:03.
         send_after = public.notify_send_after(
                        now() + make_interval(mins => power(4, least(o.attempts, 4))::integer)),
         claimed_at = null
   where o.id = p_id
  returning * into v_row;

  return v_row;
end $$;

comment on function public.claim_notifications is
  'Atomically claims due messages for one worker pass (FOR UPDATE SKIP LOCKED), '
  'reclaiming anything stuck in `sending` for more than five minutes.';
comment on function public.fail_notification is
  'Records a send failure. Retryable errors go back to queued with exponential '
  'backoff re-clamped to working hours; permanent ones dead-letter immediately.';


-- ----------------------------------------------------------------------------
-- 8. GRANTS
--
--  The worker verbs are service-role only. `authenticated` must not be able to
--  claim the outbox -- that would let any logged-in user mark every pending
--  message as sent.
-- ----------------------------------------------------------------------------

revoke execute on function
  public.enqueue_notification(text, uuid, text, jsonb),
  public.claim_notifications(integer),
  public.complete_notification(bigint, text, text),
  public.fail_notification(bigint, text, boolean)
from public, anon, authenticated;

grant execute on function
  public.enqueue_notification(text, uuid, text, jsonb),
  public.claim_notifications(integer),
  public.complete_notification(bigint, text, text),
  public.fail_notification(bigint, text, boolean)
to service_role;

grant execute on function public.notify_send_after(timestamptz) to authenticated, service_role;
revoke execute on function public.notify_send_after(timestamptz) from anon;

grant select on public.notification_outbox to authenticated;
