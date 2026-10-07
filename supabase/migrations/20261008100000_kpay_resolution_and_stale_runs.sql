-- ============================================================================
-- 0058. REJECTED KBZPAY GETS A RESOLUTION; STALE RUNS GET SEEN
--
-- ----------------------------------------------------------------------------
-- 1. A REJECTED KBZPAY WAS A DEAD END
--
-- reject_kpay_payment (0021) sets cod_status = 'pending' on a delivered parcel
-- and stops. No ledger line, no owner, no way out: the shop's goods value sat
-- "unreceived" forever and nobody was asked to recover it.
--
-- resolve_rejected_kpay closes it, ONCE, three ways:
--
--   cash_collected  the office got the money directly (the customer paid at
--                   the desk, or transferred again). cod_status -> settled:
--                   the money is in hand, so the shop can be paid.
--   charged_rider   the rider is held responsible: one `shortfall` adjustment
--                   for the full amount on this month's payroll, linked to the
--                   order. cod_status -> settled: it is recovered from pay.
--   written_off     Mingalar absorbs it: one permanent bad_debts row, with a
--                   required note. cod_status -> settled -- the shop handed
--                   over goods that were delivered, so it is still paid; the
--                   loss is the platform's, and it is on record.
--
-- Each writes an audit entry; the resolution columns are set once and the
-- function refuses an order that is not a rejected, unresolved KBZPay parcel.
--
-- ----------------------------------------------------------------------------
-- 2. A RUN LEFT OPEN OVERNIGHT WAS INVISIBLE
--
-- Nothing surfaced a run that never closed, or one still holding cash after
-- midnight. stale_runs returns every open run that has been open longer than
-- p_hours (default 18) or crossed into a new Yangon day with cash still on it.
-- "Cash on the run" is close_run_and_deposit's own figure (0052, 0055): the
-- run's cod_collected, less deposits tagged with it or taken from its rider
-- since it left, capped at what the rider holds. route_flow R14 checks the two
-- agree.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1a. Resolution columns on the order
-- ----------------------------------------------------------------------------
alter table public.orders
  add column if not exists kpay_resolution       text,
  add column if not exists kpay_resolved_at      timestamptz,
  add column if not exists kpay_resolved_by      uuid references public.profiles(id) on delete set null,
  add column if not exists kpay_resolution_note  text;

alter table public.orders drop constraint if exists orders_kpay_resolution_known;
alter table public.orders add constraint orders_kpay_resolution_known
  check (kpay_resolution is null or kpay_resolution in ('cash_collected', 'charged_rider', 'written_off'));
alter table public.orders drop constraint if exists orders_kpay_resolution_stamped;
alter table public.orders add constraint orders_kpay_resolution_stamped
  check (kpay_resolution is null or (kpay_resolved_at is not null and kpay_rejected_at is not null));

create index if not exists orders_kpay_rejected_open_idx
  on public.orders (kpay_rejected_at)
  where kpay_rejected_at is not null and kpay_resolution is null;

-- ----------------------------------------------------------------------------
-- 1b. bad_debts: the written-off record
-- ----------------------------------------------------------------------------
create table if not exists public.bad_debts (
  id          bigserial primary key,
  order_id    uuid not null unique references public.orders(id) on delete restrict,
  amount      bigint not null,
  note        text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.bad_debts drop constraint if exists bad_debts_amount_positive;
alter table public.bad_debts add constraint bad_debts_amount_positive check (amount > 0);
alter table public.bad_debts drop constraint if exists bad_debts_note_given;
alter table public.bad_debts add constraint bad_debts_note_given check (length(trim(note)) >= 3);

comment on table public.bad_debts is
  'Money the platform wrote off: a rejected KBZPay payment nobody will recover. '
  'Append-only, audited; written only by resolve_rejected_kpay (0058).';

alter table public.bad_debts enable row level security;
drop policy if exists bad_debts_read on public.bad_debts;
create policy bad_debts_read on public.bad_debts
  for select to authenticated using (public.is_dispatch());
revoke all on public.bad_debts from anon;
revoke insert, update, delete on public.bad_debts from authenticated;
grant select on public.bad_debts to authenticated;
grant all on public.bad_debts to service_role;
revoke all on sequence public.bad_debts_id_seq from anon, authenticated;

create or replace function public.tg_bad_debts_append_only()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception 'bad_debts_append_only' using errcode = '42501',
    hint = 'A write-off is permanent.';
end $$;

drop trigger if exists bad_debts_append_only on public.bad_debts;
create trigger bad_debts_append_only before update or delete on public.bad_debts
for each row execute function public.tg_bad_debts_append_only();

-- ----------------------------------------------------------------------------
-- 1c. resolve_rejected_kpay
-- ----------------------------------------------------------------------------
create or replace function public.resolve_rejected_kpay(
  p_order_id   uuid,
  p_resolution text,
  p_note       text default null
)
returns public.orders
language plpgsql security definer
set search_path = public
as $$
declare
  v_o    public.orders;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not (public.is_admin() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_resolution is null or p_resolution not in ('cash_collected', 'charged_rider', 'written_off') then
    raise exception 'kpay_resolution_unknown' using errcode = '22023';
  end if;
  if p_resolution = 'written_off' and length(coalesce(v_note, '')) < 3 then
    raise exception 'kpay_writeoff_note_required' using errcode = '22023',
      hint = 'Say why this is being written off -- the record is permanent.';
  end if;

  select * into v_o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  -- Only a delivered KBZPay parcel the office rejected, and only once.
  if v_o.status <> 'delivered'
     or v_o.payment_method <> 'cod'
     or coalesce(v_o.collected_via, 'cash') <> 'kpay'
     or v_o.kpay_rejected_at is null
     or v_o.cod_status <> 'pending' then
    raise exception 'kpay_not_awaiting_resolution' using errcode = '55000',
      hint = 'Only a rejected KBZPay payment that is still unreceived can be resolved.';
  end if;
  if v_o.kpay_resolution is not null then
    raise exception 'kpay_already_resolved: %', v_o.kpay_resolution using errcode = '55000';
  end if;

  if p_resolution = 'charged_rider' then
    if v_o.rider_id is null then
      raise exception 'order_has_no_rider' using errcode = '55000',
        hint = 'No rider is recorded on this parcel to charge.';
    end if;
    -- A payroll deduction for the full amount, this month, linked to the order.
    insert into public.cod_ledger (order_id, rider_id, kind, amount, memo, category, pay_month, created_by)
    values (v_o.id, v_o.rider_id, 'adjustment', v_o.cod_amount,
            'KBZPay rejected · ' || v_o.code || coalesce(' · ' || v_note, ''),
            'shortfall', date_trunc('month', public.mm_today())::date, auth.uid());
  elsif p_resolution = 'written_off' then
    insert into public.bad_debts (order_id, amount, note, created_by)
    values (v_o.id, v_o.cod_amount, v_note, auth.uid());
  end if;

  update public.orders
     set cod_status            = 'settled',
         kpay_resolution       = p_resolution,
         kpay_resolved_at      = now(),
         kpay_resolved_by      = auth.uid(),
         kpay_resolution_note  = v_note
   where id = p_order_id
  returning * into v_o;

  perform public.write_audit('kpay.resolve', 'orders', v_o.id::text,
    jsonb_build_object('cod_status', 'pending'),
    jsonb_build_object('resolution', p_resolution, 'amount', v_o.cod_amount,
                       'rider_id', v_o.rider_id, 'note', v_note));
  return v_o;
end $$;

comment on function public.resolve_rejected_kpay is
  'Closes a rejected KBZPay payment once: cash_collected (office has it), '
  'charged_rider (shortfall deduction on payroll) or written_off (bad_debts, '
  'note required). Clears the order so the shop can be paid (0058).';

-- ----------------------------------------------------------------------------
-- 2. stale_runs
-- ----------------------------------------------------------------------------
create or replace function public.stale_runs(p_hours integer default 18)
returns table (
  trip_id        uuid,
  route_code     text,
  rider_id       uuid,
  rider_name     text,
  status         text,
  service_date   date,
  opened_at      timestamptz,
  hours_open     integer,
  cash_on_run    bigint,
  over_hours     boolean,
  overnight_cash boolean
)
language sql stable security definer
set search_path = public
as $$
  with open_trips as (
    select t.id, t.route_id, t.rider_id, t.status::text as status, t.service_date, t.departed_at,
           coalesce(t.departed_at, t.created_at) as opened_at
      from public.trips t
     where t.status in ('planned', 'loading', 'departed', 'returned')
  ),
  measured as (
    select ot.*,
      -- close_run_and_deposit's figure: collected, less this run's deposits,
      -- capped at what the rider holds.
      greatest(least(
        coalesce((select sum(l.amount)
                    from public.cod_ledger l
                    join public.orders o on o.id = l.order_id
                   where o.trip_id = ot.id and o.trip_leg = 'delivery'
                     and l.kind = 'cod_collected' and l.rider_id = ot.rider_id), 0)
        - coalesce((select -sum(l.amount)
                      from public.cod_ledger l
                     where l.kind = 'cod_remitted'
                       and (l.trip_id = ot.id
                            or (l.trip_id is null and l.rider_id = ot.rider_id
                                and ot.departed_at is not null and l.created_at >= ot.departed_at))), 0),
        case when ot.rider_id is null then 0
             else greatest(public.rider_cash_held(ot.rider_id), 0) end
      ), 0)::bigint as cash_on_run,
      floor(extract(epoch from (now() - ot.opened_at)) / 3600)::int as hours_open
    from open_trips ot
  )
  select m.id, r.code, m.rider_id, p.full_name, m.status, m.service_date, m.opened_at,
         m.hours_open, m.cash_on_run,
         m.hours_open >= p_hours,
         m.cash_on_run > 0 and (m.opened_at at time zone 'Asia/Yangon')::date < public.mm_today()
    from measured m
    join public.routes r on r.id = m.route_id
    left join public.profiles p on p.id = m.rider_id
   where (public.is_dispatch() or public.is_service_ctx())
     and (m.hours_open >= p_hours
          or (m.cash_on_run > 0 and (m.opened_at at time zone 'Asia/Yangon')::date < public.mm_today()))
   order by m.cash_on_run desc, m.opened_at
$$;

comment on function public.stale_runs is
  'Open runs that need attention: open longer than p_hours, or carrying '
  'undeposited cash past midnight. Office only (0058).';

-- ----------------------------------------------------------------------------
-- Grants, in 0054's shape
-- ----------------------------------------------------------------------------
revoke execute on function public.resolve_rejected_kpay(uuid, text, text) from public;
revoke execute on function public.stale_runs(integer) from public;
revoke execute on function public.tg_bad_debts_append_only() from public;
grant execute on function public.resolve_rejected_kpay(uuid, text, text) to authenticated, service_role;
grant execute on function public.stale_runs(integer) to authenticated, service_role;
