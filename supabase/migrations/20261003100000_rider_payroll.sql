-- ============================================================================
-- 0057. RIDER MONTHLY PAYROLL
--
-- ----------------------------------------------------------------------------
-- THE MODEL
--
-- Riders hand in all cash every run (0052) and are paid monthly. Until now
-- "paid" meant a DAILY settlement's "Mark paid", which mixed cash
-- reconciliation with payroll and had no base salary, no period lock and no
-- payslip. From here:
--
--   SETTLEMENTS   reconcile CASH, as before. They no longer pay earnings.
--   PAYROLL       pays EARNINGS, once per rider per calendar month.
--
-- WHICH MONTH A LINE BELONGS TO (its "work month"):
--   * an explicit pay_month, for an adjustment aimed at a month, else
--   * the SERVICE DATE of the run it came from (a run closed after midnight
--     still pays into the month it was worked), else
--   * the Yangon date it was booked.
--
-- LOCKING A MONTH (lock_pay_period):
--   * only a month that has ENDED, and only once (pay_periods);
--   * refused while any run dated in or before it is still open -- its
--     earnings are not all booked yet;
--   * creates one payslip per rider: prorated base salary + run pay + parcel
--     pay + pickup pay + bonuses - deductions = net;
--   * stamps every included ledger line with its payslip_id. A stamped line
--     is never counted again, so a line booked late for a locked month simply
--     lands on the next month's payslip.
--
-- PAYING (record_payslip_payment): once. A payslip goes locked -> paid a
-- single time, with method and reference; unique (rider_id, month) and the
-- status check make a second payment for the same period impossible.
--
-- "UNSETTLED EARNINGS" (0053) now means "not yet on a payslip", since the
-- payslip is what pays it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Base salary, admin-only
-- ----------------------------------------------------------------------------
alter table public.rider_profiles
  add column if not exists base_salary bigint not null default 0;
alter table public.rider_profiles drop constraint if exists rider_profiles_base_salary_range;
alter table public.rider_profiles
  add constraint rider_profiles_base_salary_range check (base_salary between 0 and 10000000);

comment on column public.rider_profiles.base_salary is
  'Fixed monthly base salary in MMK, paid through payroll on top of variable '
  'pay. Prorated in the month a rider joins. Admin-only (tg_riders_guard).';

create or replace function public.tg_riders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Internal bookkeeping (assign_order, tg_orders_audit) sets this tx-local flag.
  if coalesce(current_setting('app.rider_guard_bypass', true), 'off') = 'on' then
    return new;
  end if;
  if public.is_admin() or public.is_service_ctx() then return new; end if;

  if new.base_area_id            is distinct from old.base_area_id
  or new.commission_pct_override is distinct from old.commission_pct_override
  or new.max_active_orders       is distinct from old.max_active_orders
  or new.cod_float_limit         is distinct from old.cod_float_limit
  or new.active_order_count      is distinct from old.active_order_count
  or new.nrc_no                  is distinct from old.nrc_no
  -- 0057: a rider cannot set their own salary.
  or new.base_salary             is distinct from old.base_salary then
    raise exception 'rider_field_admin_only'
      using errcode = '42501',
            hint = 'base_area_id, commission, capacity, float limit, NRC and base salary are super_admin-only.';
  end if;

  -- A rider may narrow their own radius, never widen it.
  if new.coverage_km > old.coverage_km then
    raise exception 'coverage_increase_admin_only' using errcode = '42501';
  end if;
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Payslips and pay periods
-- ----------------------------------------------------------------------------
create table if not exists public.payslips (
  id                uuid primary key default gen_random_uuid(),
  rider_id          uuid not null references public.rider_profiles(id) on delete restrict,
  month             date not null,
  base_salary       bigint not null default 0,   -- the rider's monthly figure at lock
  base_days         integer not null default 0,  -- days of the month they were on the books
  days_in_month     integer not null,
  base_paid         bigint not null default 0,   -- prorated
  trip_pay          bigint not null default 0,
  parcel_pay        bigint not null default 0,   -- commission_earned
  pickup_pay        bigint not null default 0,
  bonuses           bigint not null default 0,
  deductions        bigint not null default 0,
  net               bigint not null,
  line_count        integer not null default 0,
  breakdown         jsonb not null default '[]'::jsonb,   -- the adjustment lines, itemised
  status            text not null default 'locked',
  paid_at           timestamptz,
  paid_by           uuid references public.profiles(id) on delete set null,
  method            text,
  reference         text,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id) on delete set null,
  unique (rider_id, month)
);

alter table public.payslips drop constraint if exists payslips_month_is_first;
alter table public.payslips add constraint payslips_month_is_first check (extract(day from month) = 1);
alter table public.payslips drop constraint if exists payslips_status_known;
alter table public.payslips add constraint payslips_status_known check (status in ('locked', 'paid'));
alter table public.payslips drop constraint if exists payslips_method_known;
alter table public.payslips add constraint payslips_method_known
  check (method is null or method in ('bank', 'cash', 'kbzpay', 'cbpay', 'wavepay', 'ayapay'));
alter table public.payslips drop constraint if exists payslips_paid_stamped;
alter table public.payslips add constraint payslips_paid_stamped
  check (status <> 'paid' or (paid_at is not null and method is not null));
alter table public.payslips drop constraint if exists payslips_net_adds_up;
alter table public.payslips add constraint payslips_net_adds_up
  check (net = base_paid + trip_pay + parcel_pay + pickup_pay + bonuses - deductions);

create index if not exists payslips_rider_idx on public.payslips (rider_id, month desc);

create table if not exists public.pay_periods (
  month          date primary key,
  locked_at      timestamptz not null default now(),
  locked_by      uuid references public.profiles(id) on delete set null,
  payslip_count  integer not null default 0,
  total_net      bigint not null default 0
);
alter table public.pay_periods drop constraint if exists pay_periods_month_is_first;
alter table public.pay_periods add constraint pay_periods_month_is_first check (extract(day from month) = 1);

comment on table public.payslips is
  'One per rider per locked month (0057). Created by lock_pay_period, paid '
  'once by record_payslip_payment; otherwise immutable.';
comment on table public.pay_periods is
  'A row means that calendar month is LOCKED: its payslips exist and it can '
  'never be recalculated (0057).';

-- ----------------------------------------------------------------------------
-- 3. Ledger lines: category, target month, and the payslip that paid them
-- ----------------------------------------------------------------------------
alter table public.cod_ledger
  add column if not exists category   text,
  add column if not exists pay_month  date,
  add column if not exists payslip_id uuid references public.payslips(id) on delete restrict;

alter table public.cod_ledger drop constraint if exists cod_ledger_category_known;
alter table public.cod_ledger add constraint cod_ledger_category_known
  check (category is null or category in ('shortfall', 'equipment', 'penalty', 'advance', 'bonus', 'other'));
alter table public.cod_ledger drop constraint if exists cod_ledger_pay_month_is_first;
alter table public.cod_ledger add constraint cod_ledger_pay_month_is_first
  check (pay_month is null or extract(day from pay_month) = 1);

create index if not exists cod_ledger_unpaid_idx on public.cod_ledger (rider_id)
  where payslip_id is null;

-- Append-only, as 0055 -- plus ONE more permitted change: payslip_id set once.
create or replace function public.tg_cod_ledger_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'cod_ledger_append_only' using errcode = '42501',
      hint = 'Ledger lines are never deleted. Book an adjustment instead.';
  end if;
  if (to_jsonb(new) - 'settlement_id' - 'payslip_id')
       is distinct from (to_jsonb(old) - 'settlement_id' - 'payslip_id') then
    raise exception 'cod_ledger_append_only' using errcode = '42501',
      hint = 'Ledger lines are never edited. Book an adjustment instead.';
  end if;
  -- 0057: a line is paid by one payslip, once. Never moved, never released.
  if old.payslip_id is not null and new.payslip_id is distinct from old.payslip_id then
    raise exception 'cod_ledger_already_on_payslip' using errcode = '42501',
      hint = 'This line has already been paid on a payslip.';
  end if;
  return new;
end $$;

-- Direct adjustments: as 0055, and never pre-stamped with a payslip.
drop policy if exists cod_insert_admin on public.cod_ledger;
create policy cod_insert_admin on public.cod_ledger
  for insert to authenticated
  with check (
    public.is_admin()
    and kind = 'adjustment'
    and created_by = auth.uid()
    and length(trim(coalesce(memo, ''))) >= 3
    and payslip_id is null
  );

-- ----------------------------------------------------------------------------
-- 4. Payslips and periods: readable by their rider and the office; written
--    only by the functions below
-- ----------------------------------------------------------------------------
alter table public.payslips enable row level security;
alter table public.pay_periods enable row level security;

drop policy if exists payslips_read on public.payslips;
create policy payslips_read on public.payslips
  for select to authenticated
  using (rider_id = auth.uid() or public.is_dispatch());

drop policy if exists pay_periods_read on public.pay_periods;
create policy pay_periods_read on public.pay_periods
  for select to authenticated
  using (public.is_dispatch());

revoke all on public.payslips, public.pay_periods from anon;
revoke insert, update, delete on public.payslips, public.pay_periods from authenticated;
grant select on public.payslips, public.pay_periods to authenticated;
grant all on public.payslips, public.pay_periods to service_role;

-- A payslip changes once: locked -> paid, and only the payment columns.
create or replace function public.tg_payslips_guard()
returns trigger language plpgsql set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payslip_immutable' using errcode = '42501',
      hint = 'Payslips are never deleted.';
  end if;
  if old.status <> 'locked' or new.status <> 'paid'
     or (to_jsonb(new) - 'status' - 'paid_at' - 'paid_by' - 'method' - 'reference')
          is distinct from (to_jsonb(old) - 'status' - 'paid_at' - 'paid_by' - 'method' - 'reference') then
    raise exception 'payslip_immutable' using errcode = '42501',
      hint = 'A payslip is only ever marked paid, once. Correct it with an adjustment next month.';
  end if;
  return new;
end $$;

drop trigger if exists payslips_guard on public.payslips;
create trigger payslips_guard before update or delete on public.payslips
for each row execute function public.tg_payslips_guard();

create or replace function public.tg_pay_periods_immutable()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception 'pay_period_immutable' using errcode = '42501',
    hint = 'A locked month stays locked.';
end $$;

drop trigger if exists pay_periods_immutable on public.pay_periods;
create trigger pay_periods_immutable before update or delete on public.pay_periods
for each row execute function public.tg_pay_periods_immutable();

-- ----------------------------------------------------------------------------
-- 5. payroll_preview: what each rider's payslip for a month would say
-- ----------------------------------------------------------------------------
create or replace function public.payroll_preview(p_month date)
returns table (
  rider_id       uuid,
  full_name      text,
  base_salary    bigint,
  base_days      integer,
  days_in_month  integer,
  base_paid      bigint,
  trip_pay       bigint,
  parcel_pay     bigint,
  pickup_pay     bigint,
  bonuses        bigint,
  deductions     bigint,
  net            bigint,
  line_count     integer
)
language sql stable security definer
set search_path = public
as $$
  with m as (
    select date_trunc('month', p_month)::date as start,
           (date_trunc('month', p_month) + interval '1 month - 1 day')::date as finish
  ),
  lines as (
    -- Unpaid earnings and adjustment lines whose work month is this one or earlier.
    select l.rider_id, l.kind::text as kind, l.amount
      from public.cod_ledger l
      left join public.trips t on t.id = l.trip_id
      cross join m
     where l.payslip_id is null
       and l.kind in ('commission_earned', 'trip_pay', 'pickup_pay', 'adjustment', 'platform_fee')
       and coalesce(l.pay_month,
                    date_trunc('month', coalesce(t.service_date,
                                                 (l.created_at at time zone 'Asia/Yangon')::date))::date)
           <= m.start
  ),
  sums as (
    select rider_id,
           coalesce(-sum(amount) filter (where kind = 'trip_pay'), 0)::bigint          as trip_pay,
           coalesce(-sum(amount) filter (where kind = 'commission_earned'), 0)::bigint as parcel_pay,
           coalesce(-sum(amount) filter (where kind = 'pickup_pay'), 0)::bigint        as pickup_pay,
           -- An adjustment below zero is owed TO the rider: a bonus.
           coalesce(-sum(amount) filter (where kind in ('adjustment', 'platform_fee') and amount < 0), 0)::bigint as bonuses,
           coalesce(sum(amount)  filter (where kind in ('adjustment', 'platform_fee') and amount > 0), 0)::bigint as deductions,
           count(*)::int as line_count
      from lines
     group by rider_id
  ),
  riders as (
    select r.id, p.full_name, r.base_salary,
           -- Days on the books this month: from joining (or the 1st) to month end.
           greatest(0, (m.finish - greatest(m.start, (r.created_at at time zone 'Asia/Yangon')::date)) + 1)::int
             as base_days,
           (m.finish - m.start + 1)::int as days_in_month,
           p.is_active
      from public.rider_profiles r
      join public.profiles p on p.id = r.id
      cross join m
  )
  select
    r.id,
    r.full_name,
    r.base_salary,
    case when r.is_active then r.base_days else 0 end,
    r.days_in_month,
    b.base_paid,
    coalesce(s.trip_pay, 0),
    coalesce(s.parcel_pay, 0),
    coalesce(s.pickup_pay, 0),
    coalesce(s.bonuses, 0),
    coalesce(s.deductions, 0),
    b.base_paid + coalesce(s.trip_pay, 0) + coalesce(s.parcel_pay, 0) + coalesce(s.pickup_pay, 0)
      + coalesce(s.bonuses, 0) - coalesce(s.deductions, 0),
    coalesce(s.line_count, 0)
  from riders r
  left join sums s on s.rider_id = r.id
  cross join lateral (
    select case when r.is_active and r.base_salary > 0
                then (r.base_salary * r.base_days / r.days_in_month)::bigint
                else 0 end as base_paid
  ) b
  where (public.is_dispatch() or public.is_service_ctx())
    -- Only riders with something to pay or deduct this month.
    and (b.base_paid <> 0 or s.rider_id is not null)
  order by r.full_name
$$;

comment on function public.payroll_preview is
  'What each rider''s payslip for a month would say: prorated base + unpaid '
  'run, parcel and pickup pay + bonuses - deductions, over every unpaid line '
  'whose work month is that month or earlier (0057). Office only.';

-- ----------------------------------------------------------------------------
-- 6. lock_pay_period: create the payslips, stamp the lines, never again
-- ----------------------------------------------------------------------------
create or replace function public.lock_pay_period(p_month date)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_start  date := date_trunc('month', p_month)::date;
  v_finish date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_open   integer;
  v_count  integer := 0;
  v_total  bigint  := 0;
  r        record;
  v_id     uuid;
begin
  if not (public.is_admin() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_month is null then
    raise exception 'month_required' using errcode = '22023';
  end if;

  -- One lock at a time; the period row is the "never twice" record.
  perform pg_advisory_xact_lock(hashtext('pay_period'), extract(epoch from v_start)::int);
  if exists (select 1 from public.pay_periods where month = v_start) then
    raise exception 'period_locked: %', to_char(v_start, 'YYYY-MM') using errcode = '55000',
      hint = 'This month is already locked. Corrections go on next month as adjustments.';
  end if;

  -- Only a month that has ended.
  if v_finish >= public.mm_today() then
    raise exception 'period_not_ended: %', to_char(v_start, 'YYYY-MM') using errcode = '55000',
      hint = 'A month can be locked from the day after it ends.';
  end if;

  -- Its runs must all be finished, or their pay is not booked yet.
  select count(*) into v_open
    from public.trips t
   where t.service_date <= v_finish
     and t.status in ('planned', 'loading', 'departed', 'returned');
  if v_open > 0 then
    raise exception 'period_has_open_runs: %', v_open using errcode = '55000',
      hint = 'Close or cancel every run dated in or before this month first.';
  end if;

  for r in select * from public.payroll_preview(v_start) loop
    insert into public.payslips (rider_id, month, base_salary, base_days, days_in_month, base_paid,
                                 trip_pay, parcel_pay, pickup_pay, bonuses, deductions, net,
                                 line_count, breakdown, created_by)
    values (r.rider_id, v_start, r.base_salary, r.base_days, r.days_in_month, r.base_paid,
            r.trip_pay, r.parcel_pay, r.pickup_pay, r.bonuses, r.deductions, r.net,
            r.line_count,
            coalesce((
              select jsonb_agg(jsonb_build_object(
                       'amount', l.amount, 'category', l.category, 'memo', l.memo,
                       'booked', l.created_at) order by l.created_at)
                from public.cod_ledger l
                left join public.trips t on t.id = l.trip_id
               where l.rider_id = r.rider_id and l.payslip_id is null
                 and l.kind in ('adjustment', 'platform_fee')
                 and coalesce(l.pay_month,
                              date_trunc('month', coalesce(t.service_date,
                                         (l.created_at at time zone 'Asia/Yangon')::date))::date) <= v_start
            ), '[]'::jsonb),
            auth.uid())
    returning id into v_id;

    -- Stamp exactly the lines the preview counted.
    update public.cod_ledger l
       set payslip_id = v_id
      from public.cod_ledger l2
      left join public.trips t on t.id = l2.trip_id
     where l.id = l2.id
       and l.rider_id = r.rider_id
       and l.payslip_id is null
       and l.kind in ('commission_earned', 'trip_pay', 'pickup_pay', 'adjustment', 'platform_fee')
       and coalesce(l2.pay_month,
                    date_trunc('month', coalesce(t.service_date,
                               (l2.created_at at time zone 'Asia/Yangon')::date))::date) <= v_start;

    v_count := v_count + 1;
    v_total := v_total + r.net;
  end loop;

  insert into public.pay_periods (month, locked_by, payslip_count, total_net)
  values (v_start, auth.uid(), v_count, v_total);

  perform public.write_audit('payroll.lock', 'pay_periods', to_char(v_start, 'YYYY-MM'), null,
    jsonb_build_object('payslips', v_count, 'total_net', v_total));
  return v_count;
end $$;

comment on function public.lock_pay_period is
  'Locks an ended calendar month: refuses a month already locked or with open '
  'runs, creates one payslip per rider from payroll_preview, and stamps each '
  'included ledger line with its payslip so it is never paid twice (0057).';

-- ----------------------------------------------------------------------------
-- 7. record_payslip_payment: once
-- ----------------------------------------------------------------------------
create or replace function public.record_payslip_payment(
  p_payslip_id uuid,
  p_method     text,
  p_reference  text default null
)
returns public.payslips
language plpgsql security definer
set search_path = public
as $$
declare v_p public.payslips;
begin
  if not (public.is_admin() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_method is null or p_method not in ('bank', 'cash', 'kbzpay', 'cbpay', 'wavepay', 'ayapay') then
    raise exception 'payslip_method_unknown' using errcode = '22023';
  end if;
  if p_method <> 'cash' and length(trim(coalesce(p_reference, ''))) = 0 then
    raise exception 'payslip_reference_required' using errcode = '22023',
      hint = 'Enter the bank or wallet transaction reference.';
  end if;

  select * into v_p from public.payslips where id = p_payslip_id for update;
  if not found then
    raise exception 'payslip_not_found' using errcode = 'P0002';
  end if;
  if v_p.status = 'paid' then
    raise exception 'payslip_already_paid' using errcode = '55000',
      hint = 'This payslip was paid on ' || to_char(v_p.paid_at, 'YYYY-MM-DD') || '.';
  end if;
  if v_p.net <= 0 then
    raise exception 'payslip_nothing_to_pay' using errcode = '55000',
      hint = 'Deductions cover the whole month; there is nothing to pay.';
  end if;

  update public.payslips
     set status = 'paid', paid_at = now(), paid_by = auth.uid(),
         method = p_method, reference = nullif(trim(coalesce(p_reference, '')), '')
   where id = p_payslip_id
  returning * into v_p;

  perform public.write_audit('payroll.pay', 'payslips', v_p.id::text, null,
    jsonb_build_object('rider_id', v_p.rider_id, 'month', v_p.month, 'net', v_p.net,
                       'method', v_p.method, 'reference', v_p.reference));
  return v_p;
end $$;

comment on function public.record_payslip_payment is
  'Pays a locked payslip exactly once, recording method and reference. A '
  'second call for the same payslip is refused (0057).';

-- ----------------------------------------------------------------------------
-- 8. "Unsettled earnings" now means "not yet on a payslip"
-- ----------------------------------------------------------------------------
create or replace function public.rider_unsettled_earnings(p_rider_id uuid)
returns bigint language plpgsql stable security definer set search_path = public
as $$
begin
  if p_rider_id is distinct from auth.uid()
     and not (public.is_dispatch() or public.is_service_ctx()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- 0057: the payslip pays earnings, so "unsettled" = not on one yet.
  return coalesce((
    select -sum(l.amount)
      from public.cod_ledger l
     where l.rider_id = p_rider_id
       and l.payslip_id is null
       and l.kind in ('commission_earned', 'trip_pay', 'pickup_pay', 'adjustment', 'platform_fee')
  ), 0)::bigint;
end $$;

-- cod_positions' unsettled_earnings column follows the same rule.
drop function if exists public.cod_positions();

create or replace function public.cod_positions()
returns table (
  rider_id        uuid,
  full_name       text,
  phone           text,
  base_area       text,
  is_active       boolean,
  cod_collected   bigint,
  cod_remitted    bigint,
  commission      bigint,
  trip_pay        bigint,
  pickup_pay      bigint,
  adjustments     bigint,
  open_balance    bigint,
  settled_total   bigint,
  cod_float_limit bigint,
  open_since      timestamptz,
  last_entry_at   timestamptz,
  entry_count     bigint,
  cash_in_hand       bigint,
  unsettled_earnings bigint
)
language sql stable security invoker
set search_path = public
as $$
  select
    r.id,
    p.full_name,
    p.phone,
    a.name,
    p.is_active,
    coalesce(sum(l.amount) filter (where l.kind = 'cod_collected'), 0)::bigint,
    coalesce(-sum(l.amount) filter (where l.kind = 'cod_remitted'), 0)::bigint,
    coalesce(-sum(l.amount) filter (where l.kind = 'commission_earned'), 0)::bigint,
    coalesce(-sum(l.amount) filter (where l.kind = 'trip_pay'), 0)::bigint,
    -- 0047. Was inside open_balance and in no column, so the breakdown did not
    -- reconcile to the total beside it.
    coalesce(-sum(l.amount) filter (where l.kind = 'pickup_pay'), 0)::bigint,
    coalesce(sum(l.amount) filter (where l.kind in ('adjustment','platform_fee')), 0)::bigint,
    coalesce(sum(l.amount) filter (where l.settlement_id is null), 0)::bigint,
    coalesce(sum(l.amount) filter (where l.settlement_id is not null), 0)::bigint,
    r.cod_float_limit,
    min(l.created_at) filter (where l.settlement_id is null),
    max(l.created_at),
    count(l.id),
    -- 0053. Cash the rider is carrying: the two cash kinds, unsettled.
    coalesce(sum(l.amount) filter (where l.settlement_id is null
                                     and l.kind in ('cod_collected','cod_remitted')), 0)::bigint,
    -- 0053. What the rider is owed: earnings less adjustments, unsettled.
    -- 0057: not yet on a payslip.
    coalesce(-sum(l.amount) filter (where l.payslip_id is null
                                      and l.kind in ('commission_earned','trip_pay','pickup_pay',
                                                     'adjustment','platform_fee')), 0)::bigint
  from public.rider_profiles r
  join public.profiles p on p.id = r.id
  left join public.service_areas a on a.id = r.base_area_id
  left join public.cod_ledger l on l.rider_id = r.id
  group by r.id, p.full_name, p.phone, a.name, p.is_active, r.cod_float_limit
  order by coalesce(sum(l.amount) filter (where l.settlement_id is null), 0) desc,
           p.full_name;
$$;

grant execute on function public.cod_positions() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9. Grants, in 0054's shape
-- ----------------------------------------------------------------------------
revoke execute on function public.payroll_preview(date) from public;
revoke execute on function public.lock_pay_period(date) from public;
revoke execute on function public.record_payslip_payment(uuid, text, text) from public;
revoke execute on function public.cod_positions() from public;
revoke execute on function public.tg_payslips_guard() from public;
revoke execute on function public.tg_pay_periods_immutable() from public;
grant execute on function public.payroll_preview(date) to authenticated, service_role;
grant execute on function public.lock_pay_period(date) to authenticated, service_role;
grant execute on function public.record_payslip_payment(uuid, text, text) to authenticated, service_role;
