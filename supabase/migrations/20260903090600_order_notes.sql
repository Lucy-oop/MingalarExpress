-- ============================================================================
--  MINGALAR EXPRESS  ·  0017 — THE CONTACT LOG
--
--  0016 removed the automated SMS and replaced it with people: the rider phones
--  the office, the office phones the shop. That works, and it leaves nothing
--  behind. A conversation on Viber at 4pm is not in the system at 9am the next
--  morning when a different dispatcher picks up the same parcel.
--
--  This is where those conversations live. Append-only, attributed, timestamped.
--
--  WHY A TABLE AND NOT A COLUMN. `orders.resolution_note` already exists and is
--  the wrong shape twice over: it holds ONE note, overwritten the next time the
--  parcel is resolved, and it has no author and no timestamp. A log needs many
--  rows, each with a name against it.
--
--  WHY NOT order_status_events. That trail is written by tg_orders_audit for
--  real status transitions and nothing else. Putting a phone call in it would
--  mean inventing a transition that did not happen, in the one table the system
--  trusts to tell it what did.
--
--  WHY APPEND-ONLY. Same reason as cod_ledger: a record you can quietly edit is
--  not a record. There is no UPDATE or DELETE policy, so a mistake is corrected
--  by writing the correction, and both stay visible.
--
--  WHO CAN READ IT: dispatch, and only dispatch.
--
--  That is a real decision and worth stating. A log the shop can read is a log
--  dispatchers write carefully, and half of what makes a contact log useful is
--  the unguarded half -- "third time nobody home, suspect the address is wrong".
--  The shop is not kept in the dark by this: the office is talking to them
--  directly on Viber, which is the entire point of the new flow, and the shop
--  still sees its own decision on its own parcel page.
--
--  If that changes, the extension point is a `visible_to_shop boolean` and one
--  more clause in the read policy -- not a wider policy over everything here.
--
--  Forward-only.
-- ============================================================================

set check_function_bodies = off;


-- ----------------------------------------------------------------------------
-- 1. The log
-- ----------------------------------------------------------------------------

create table if not exists public.order_notes (
  id          bigserial primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,

  -- Kept even if the author's profile is later removed: an unattributed note is
  -- worth more than a deleted one.
  author_id   uuid references public.profiles(id) on delete set null,
  author_role public.user_role,

  --  note      something the office wrote down
  --  contact   somebody was actually reached (party + channel say who and how)
  --  decision  written by resolve_failed_order, never typed by hand
  kind        text not null default 'note'
                check (kind in ('note','contact','decision')),

  party       text check (party is null or party in ('shop','customer','rider','other')),
  channel     text check (channel is null or channel in ('phone','viber','telegram','in_person','other')),

  body        text not null check (length(trim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);

-- Only a `contact` says who was reached. A 'note' claiming a channel would read
-- as a call that never happened.
alter table public.order_notes drop constraint if exists order_notes_contact_shape;
alter table public.order_notes
  add constraint order_notes_contact_shape
    check (kind = 'contact' or (party is null and channel is null));

-- The log is always read newest-first for one parcel, and never scanned whole.
create index if not exists order_notes_order_idx
  on public.order_notes (order_id, created_at desc);

comment on table public.order_notes is
  'Append-only contact log: what the office was told, by whom, over which '
  'channel. Dispatch-only. Replaces the automated SMS removed in 0016.';
comment on column public.order_notes.kind is
  'note | contact | decision. `decision` rows are written by '
  'resolve_failed_order and are the history behind orders.resolution_note, '
  'which only ever holds the latest one.';


-- ----------------------------------------------------------------------------
-- 2. RLS
--
--  SELECT and INSERT only. The absence of an UPDATE or DELETE policy is what
--  makes this append-only -- there is nothing to enforce, because there is no
--  policy that would permit it.
--
--  `author_id = auth.uid()` in the WITH CHECK matters: without it a dispatcher
--  could file a note under a colleague's name, which is exactly the kind of
--  thing an attributed log exists to prevent.
-- ----------------------------------------------------------------------------

alter table public.order_notes enable row level security;

drop policy if exists order_notes_read_dispatch on public.order_notes;
create policy order_notes_read_dispatch on public.order_notes
  for select to authenticated
  using (public.is_dispatch());

drop policy if exists order_notes_write_dispatch on public.order_notes;
create policy order_notes_write_dispatch on public.order_notes
  for insert to authenticated
  with check (public.is_dispatch() and author_id = auth.uid());

grant select, insert on public.order_notes to authenticated;
-- bigserial: without the sequence grant every insert fails on nextval.
grant usage, select on sequence public.order_notes_id_seq to authenticated;


-- ----------------------------------------------------------------------------
-- 3. resolve_failed_order also files the decision
--
--  Unchanged from 0011 apart from the insert. A definer function, so it writes
--  the row for a SHOP too -- which is the one thing that crosses the
--  dispatch-only boundary, on purpose: the office wants the shop's own words in
--  the same column as everything else.
-- ----------------------------------------------------------------------------

create or replace function public.resolve_failed_order(
  p_order_id   uuid,
  p_resolution text,
  p_note       text default null
) returns public.orders
language plpgsql security definer
set search_path = public
as $$
declare
  v_o        public.orders;
  v_attempts integer;
  v_note     text := nullif(trim(coalesce(p_note, '')), '');
begin
  if p_resolution not in ('retry','return','cancel') then
    raise exception 'bad_resolution: %', p_resolution using errcode = '22023';
  end if;

  select * into v_o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  -- Definer functions bypass RLS, so the policy test is restated here.
  if not (public.owns_shop(v_o.shop_id) or public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Only a parcel that has actually failed can be resolved. Note this covers a
  -- parcel that failed and was then AUTO-RETRIED back to `pending` by
  -- close_trip: it is the useful moment to say "stop, bring it back", and its
  -- status alone no longer shows that anything went wrong.
  v_attempts := (select count(*)::integer from public.order_status_events e
                  where e.order_id = p_order_id and e.to_status = 'failed');
  if v_attempts = 0 then
    raise exception 'order_never_failed' using errcode = '55000',
      hint = 'Cancel a pending parcel instead; there is nothing to resolve.';
  end if;
  if v_o.status in ('delivered','cancelled') then
    raise exception 'order_closed: %', v_o.status using errcode = '55000';
  end if;
  -- A parcel a rider is physically carrying is not the shop's to redirect.
  if v_o.status in ('assigned','picked_up') then
    raise exception 'order_in_flight: %', v_o.status using errcode = '55000',
      hint = 'It is out with a rider again. Wait for this attempt to finish.';
  end if;

  update public.orders set
      resolution      = p_resolution,
      resolution_note = v_note,
      resolved_at     = now(),
      resolved_by     = auth.uid(),
      -- 'retry'  : back into the pool. fail_reason is cleared because the next
      --            attempt starts clean, exactly as assign_order does it.
      -- 'cancel' : terminal. The status machine stamps closed_at.
      -- 'return' : status is NOT touched. The parcel stays where it is and the
      --            resolution is what removes it from the delivery pool; 0012
      --            gives it a real `returned` status once it can actually travel.
      status          = case
                          when p_resolution = 'retry'  then 'pending'::public.order_status
                          when p_resolution = 'cancel' then 'cancelled'::public.order_status
                          else status
                        end,
      fail_reason     = case when p_resolution = 'retry' then null else fail_reason end,
      cancel_reason   = case
                          when p_resolution = 'cancel'
                          then coalesce(v_note, 'Cancelled by the shop after a failed delivery')
                          else cancel_reason
                        end
   where id = p_order_id
   returning * into v_o;

  -- The decision joins the contact log (0017). orders.resolution_note holds only
  -- the CURRENT decision and is overwritten if the parcel is resolved twice; the
  -- log is the history, and it is where the office reads the whole story of a
  -- parcel in one column.
  insert into public.order_notes (order_id, author_id, author_role, kind, body)
  values (p_order_id, auth.uid(), public.auth_role(), 'decision',
          case p_resolution
            when 'retry'  then 'Decision: try again.'
            when 'return' then 'Decision: return to the shop.'
            else 'Decision: cancel the order.'
          end || coalesce(' ' || v_note, ''));

  perform public.write_audit('order.resolve_failed', 'orders', p_order_id::text,
    jsonb_build_object('status', v_o.status, 'attempts', v_attempts),
    jsonb_build_object('resolution', p_resolution, 'note', v_note));

  return v_o;
end $$;
