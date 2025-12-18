-- Backend foundation updates:
-- - Introduce snake_case tenant keys (`company_code`) alongside existing `companyCode`
-- - Add `job_sites`, `schedules`, and `credential_reset_requests` per current backend requirements

begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'credential_reset_request_type'
      and n.nspname = 'public'
      and t.typtype = 'e'
  ) then
    create type public.credential_reset_request_type as enum ('username', 'pin', 'both');
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'credential_reset_request_status'
      and n.nspname = 'public'
      and t.typtype = 'e'
  ) then
    create type public.credential_reset_request_status as enum ('pending', 'approved', 'denied');
  end if;
end $$;

-- ------------------------------------------------------------------
-- Rename legacy `locations` table -> `job_sites` (required table name)
-- ------------------------------------------------------------------
do $$
begin
  if to_regclass('public.locations') is not null and to_regclass('public.job_sites') is null then
    alter table public.locations rename to job_sites;
  end if;
end $$;

-- ------------------------------------------------------------------
-- Required tables/columns (snake_case compatibility columns)
-- ------------------------------------------------------------------

-- companies: add required `company_code`, `name`, `created_at`
alter table public.companies
  add column if not exists company_code text generated always as ("companyCode") stored,
  add column if not exists name text generated always as ("companyName") stored,
  add column if not exists created_at timestamptz generated always as ("createdAt") stored;

create unique index if not exists companies_company_code_uq_v2
  on public.companies (company_code);

-- users: add required `company_code`, `pin_hash`, `created_at`
alter table public.users
  add column if not exists company_code text generated always as ("companyCode") stored,
  add column if not exists pin_hash text generated always as ("pinHash") stored,
  add column if not exists created_at timestamptz generated always as ("createdAt") stored,
  add column if not exists updated_at timestamptz generated always as ("updatedAt") stored;

-- users must link to auth.users.id
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_auth_users_fk'
  ) then
    alter table public.users
      add constraint users_auth_users_fk
      foreign key (id) references auth.users (id)
      on delete cascade
      not valid;
    alter table public.users validate constraint users_auth_users_fk;
  end if;
end $$;

-- Enable composite FKs (used by credential_reset_requests constraints)
create unique index if not exists users_company_code_id_uq_v2
  on public.users (company_code, id);

-- employees: add required `company_code`, `created_at`
alter table public.employees
  add column if not exists company_code text generated always as ("companyCode") stored,
  add column if not exists created_at timestamptz generated always as ("createdAt") stored,
  add column if not exists updated_at timestamptz generated always as ("updatedAt") stored;

create unique index if not exists employees_company_code_id_uq_v2
  on public.employees (company_code, id);

-- job_sites (renamed from locations): add required `company_code`, `created_at`
alter table public.job_sites
  add column if not exists company_code text generated always as ("companyCode") stored,
  add column if not exists created_at timestamptz generated always as ("createdAt") stored,
  add column if not exists updated_at timestamptz generated always as ("updatedAt") stored;

create unique index if not exists job_sites_company_code_id_uq_v2
  on public.job_sites (company_code, id);

-- ------------------------------------------------------------------
-- schedules (new)
-- ------------------------------------------------------------------
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  company_code text not null,
  week_start_date date not null,
  created_at timestamptz not null default now(),
  constraint schedules_company_code_upper check (company_code = upper(company_code)),
  constraint schedules_company_week_unique unique (company_code, week_start_date),
  constraint schedules_company_code_id_unique unique (company_code, id),
  constraint schedules_company_fk foreign key (company_code)
    references public.companies (company_code)
);

create index if not exists schedules_company_code_idx on public.schedules (company_code);
create index if not exists schedules_company_code_week_start_date_idx on public.schedules (company_code, week_start_date);

-- ------------------------------------------------------------------
-- shifts: add required columns and connect to schedules
-- ------------------------------------------------------------------
alter table public.shifts
  add column if not exists company_code text generated always as ("companyCode") stored,
  add column if not exists schedule_id uuid,
  add column if not exists employee_id uuid generated always as ("empId") stored,
  add column if not exists job_site_id uuid generated always as ("locId") stored,
  add column if not exists start_time timestamp generated always as (date + start) stored,
  add column if not exists end_time timestamp generated always as (date + "end") stored,
  add column if not exists created_at timestamptz generated always as ("createdAt") stored,
  add column if not exists updated_at timestamptz generated always as ("updatedAt") stored;

-- Backfill schedules based on existing shifts (if any)
insert into public.schedules (company_code, week_start_date)
select distinct
  s.company_code,
  date_trunc('week', s.date::timestamp)::date as week_start_date
from public.shifts s
where s.schedule_id is null
on conflict (company_code, week_start_date) do nothing;

update public.shifts sh
set schedule_id = sc.id
from public.schedules sc
where sh.schedule_id is null
  and sc.company_code = sh.company_code
  and sc.week_start_date = date_trunc('week', sh.date::timestamp)::date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shifts_schedule_fk_v2'
  ) then
    alter table public.shifts
      add constraint shifts_schedule_fk_v2
      foreign key (company_code, schedule_id)
      references public.schedules (company_code, id)
      on delete restrict
      not valid;
    alter table public.shifts validate constraint shifts_schedule_fk_v2;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from public.shifts where schedule_id is null) then
    alter table public.shifts alter column schedule_id set not null;
  end if;
end $$;

create index if not exists shifts_company_code_schedule_id_idx on public.shifts (company_code, schedule_id);

-- ------------------------------------------------------------------
-- credential_reset_requests (new; replaces/augments legacy `requests`)
-- ------------------------------------------------------------------
create table if not exists public.credential_reset_requests (
  id uuid primary key default gen_random_uuid(),
  company_code text not null,
  requested_by_user_id uuid not null,
  target_user_id uuid not null,
  request_type public.credential_reset_request_type not null,
  status public.credential_reset_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  constraint credential_reset_requests_company_code_upper check (company_code = upper(company_code)),
  constraint credential_reset_requests_requested_by_fk foreign key (company_code, requested_by_user_id)
    references public.users (company_code, id) on delete cascade,
  constraint credential_reset_requests_target_fk foreign key (company_code, target_user_id)
    references public.users (company_code, id) on delete cascade
);

create index if not exists credential_reset_requests_company_code_idx
  on public.credential_reset_requests (company_code);
create index if not exists credential_reset_requests_company_code_status_idx
  on public.credential_reset_requests (company_code, status);
create index if not exists credential_reset_requests_target_user_id_idx
  on public.credential_reset_requests (target_user_id);

commit;
