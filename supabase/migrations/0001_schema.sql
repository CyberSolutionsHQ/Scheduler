-- Schema for Cyber Solutions LLC Schedule Manager (per HANDOFF_SUPABASE_CONTRACT.md)

begin;

-- Extensions
create extension if not exists pgcrypto;

-- Enums (match contract strings)
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'user_role' and n.nspname = 'public' and t.typtype = 'e'
  ) then
    create type public.user_role as enum ('platform_admin', 'manager', 'employee');
  end if;
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'request_type' and n.nspname = 'public' and t.typtype = 'e'
  ) then
    create type public.request_type as enum (
      'manager_change_credentials',
      'employee_change_credentials',
      'admin_change_credentials'
    );
  end if;
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'request_status' and n.nspname = 'public' and t.typtype = 'e'
  ) then
    create type public.request_status as enum ('pending', 'approved', 'denied');
  end if;
end $$;

-- Timestamp helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new."updatedAt" = now();
  return new;
end $$;

-- Prevent companyCode mutations (anti-privilege-escalation guardrail)
create or replace function public.prevent_company_code_update()
returns trigger
language plpgsql
as $$
begin
  if new."companyCode" is distinct from old."companyCode" then
    raise exception 'companyCode is immutable';
  end if;
  return new;
end $$;

-- companies
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  "companyCode" text not null,
  "companyName" text not null,
  "isDisabled" boolean not null default false,
  "supportEnabled" boolean not null default false,
  "createdAt" timestamptz not null default now(),
  constraint companies_company_code_upper check ("companyCode" = upper("companyCode")),
  constraint companies_company_code_unique unique ("companyCode")
);

create trigger companies_no_company_code_update
before update on public.companies
for each row execute function public.prevent_company_code_update();

create index if not exists companies_company_code_idx on public.companies ("companyCode");

-- users (app-level profile/mapping for auth.uid(); id is auth user id)
create table if not exists public.users (
  id uuid primary key,
  "companyCode" text not null,
  username text not null,
  "pinHash" text not null,
  role public.user_role not null,
  "employeeId" uuid null,
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint users_company_code_upper check ("companyCode" = upper("companyCode")),
  constraint users_username_lower check (username = lower(username)),
  constraint users_unique_username_per_company unique ("companyCode", username),
  constraint users_employee_role_requires_employee_id check (
    (role <> 'employee' and "employeeId" is null) or (role = 'employee' and "employeeId" is not null)
  )
);

create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

create trigger users_no_company_code_update
before update on public.users
for each row execute function public.prevent_company_code_update();

create index if not exists users_company_code_idx on public.users ("companyCode");
create index if not exists users_company_code_role_idx on public.users ("companyCode", role);
create index if not exists users_company_code_employee_id_idx on public.users ("companyCode", "employeeId");

-- employees
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  "companyCode" text not null,
  name text not null,
  contact text not null default '',
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint employees_company_code_upper check ("companyCode" = upper("companyCode")),
  constraint employees_company_code_id_unique unique ("companyCode", id)
);

create trigger employees_set_updated_at
before update on public.employees
for each row execute function public.set_updated_at();

create trigger employees_no_company_code_update
before update on public.employees
for each row execute function public.prevent_company_code_update();

create index if not exists employees_company_code_idx on public.employees ("companyCode");
create index if not exists employees_company_code_active_idx on public.employees ("companyCode", active);

alter table public.users
  add constraint users_employee_fk
  foreign key ("companyCode", "employeeId")
  references public.employees ("companyCode", id)
  deferrable initially deferred;

-- locations
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  "companyCode" text not null,
  name text not null,
  address text not null default '',
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint locations_company_code_upper check ("companyCode" = upper("companyCode")),
  constraint locations_company_code_id_unique unique ("companyCode", id)
);

create trigger locations_set_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

create trigger locations_no_company_code_update
before update on public.locations
for each row execute function public.prevent_company_code_update();

create index if not exists locations_company_code_idx on public.locations ("companyCode");

-- job_types
create table if not exists public.job_types (
  id uuid primary key default gen_random_uuid(),
  "companyCode" text not null,
  name text not null,
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint job_types_company_code_upper check ("companyCode" = upper("companyCode")),
  constraint job_types_company_code_id_unique unique ("companyCode", id)
);

create trigger job_types_set_updated_at
before update on public.job_types
for each row execute function public.set_updated_at();

create trigger job_types_no_company_code_update
before update on public.job_types
for each row execute function public.prevent_company_code_update();

create index if not exists job_types_company_code_idx on public.job_types ("companyCode");

-- crews
create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  "companyCode" text not null,
  name text not null,
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint crews_company_code_upper check ("companyCode" = upper("companyCode")),
  constraint crews_company_code_id_unique unique ("companyCode", id)
);

create trigger crews_set_updated_at
before update on public.crews
for each row execute function public.set_updated_at();

create trigger crews_no_company_code_update
before update on public.crews
for each row execute function public.prevent_company_code_update();

create index if not exists crews_company_code_idx on public.crews ("companyCode");

-- crew_members
create table if not exists public.crew_members (
  id uuid primary key default gen_random_uuid(),
  "companyCode" text not null,
  "crewId" uuid not null,
  "employeeId" uuid not null,
  "createdAt" timestamptz not null default now(),
  constraint crew_members_company_code_upper check ("companyCode" = upper("companyCode")),
  constraint crew_members_company_code_crew_fk foreign key ("companyCode", "crewId")
    references public.crews ("companyCode", id) on delete cascade,
  constraint crew_members_company_code_employee_fk foreign key ("companyCode", "employeeId")
    references public.employees ("companyCode", id) on delete cascade,
  constraint crew_members_unique_membership unique ("companyCode", "crewId", "employeeId")
);

create trigger crew_members_no_company_code_update
before update on public.crew_members
for each row execute function public.prevent_company_code_update();

create index if not exists crew_members_company_code_idx on public.crew_members ("companyCode");
create index if not exists crew_members_company_code_employee_id_idx on public.crew_members ("companyCode", "employeeId");
create index if not exists crew_members_company_code_crew_id_idx on public.crew_members ("companyCode", "crewId");

-- shifts
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  "companyCode" text not null,
  date date not null,
  start time not null,
  "end" time not null,
  notes text not null default '',
  "locId" uuid not null,
  "empId" uuid null,
  "crewId" uuid null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint shifts_company_code_upper check ("companyCode" = upper("companyCode")),
  constraint shifts_company_code_id_unique unique ("companyCode", id),
  constraint shifts_xor_target check (("empId" is null) <> ("crewId" is null)),
  constraint shifts_company_code_loc_fk foreign key ("companyCode", "locId")
    references public.locations ("companyCode", id),
  constraint shifts_company_code_emp_fk foreign key ("companyCode", "empId")
    references public.employees ("companyCode", id),
  constraint shifts_company_code_crew_fk foreign key ("companyCode", "crewId")
    references public.crews ("companyCode", id)
);

create trigger shifts_set_updated_at
before update on public.shifts
for each row execute function public.set_updated_at();

create trigger shifts_no_company_code_update
before update on public.shifts
for each row execute function public.prevent_company_code_update();

create index if not exists shifts_company_code_idx on public.shifts ("companyCode");
create index if not exists shifts_company_code_date_idx on public.shifts ("companyCode", date);
create index if not exists shifts_company_code_emp_date_idx on public.shifts ("companyCode", "empId", date);
create index if not exists shifts_company_code_crew_date_idx on public.shifts ("companyCode", "crewId", date);

-- shift_jobs
create table if not exists public.shift_jobs (
  id uuid primary key default gen_random_uuid(),
  "companyCode" text not null,
  "shiftId" uuid not null,
  "jobTypeId" uuid not null,
  "createdAt" timestamptz not null default now(),
  constraint shift_jobs_company_code_upper check ("companyCode" = upper("companyCode")),
  constraint shift_jobs_company_code_shift_fk foreign key ("companyCode", "shiftId")
    references public.shifts ("companyCode", id) on delete cascade,
  constraint shift_jobs_company_code_job_type_fk foreign key ("companyCode", "jobTypeId")
    references public.job_types ("companyCode", id) on delete restrict,
  constraint shift_jobs_unique_per_shift unique ("companyCode", "shiftId", "jobTypeId")
);

create trigger shift_jobs_no_company_code_update
before update on public.shift_jobs
for each row execute function public.prevent_company_code_update();

create index if not exists shift_jobs_company_code_idx on public.shift_jobs ("companyCode");
create index if not exists shift_jobs_company_code_shift_id_idx on public.shift_jobs ("companyCode", "shiftId");

-- requests
create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  "companyCode" text not null,
  type public.request_type not null,
  status public.request_status not null default 'pending',
  "requesterUserId" uuid not null references public.users (id) on delete cascade,
  "targetUserId" uuid not null references public.users (id) on delete cascade,
  "proposedUsername" text not null default '',
  "proposedPin" text not null default '',
  "createdAt" timestamptz not null default now(),
  "handledAt" timestamptz null,
  "handledBy" uuid null references public.users (id),
  "decisionNote" text null,
  constraint requests_company_code_upper check ("companyCode" = upper("companyCode")),
  constraint requests_proposed_username_lower check ("proposedUsername" = '' or "proposedUsername" = lower("proposedUsername"))
);

create trigger requests_no_company_code_update
before update on public.requests
for each row execute function public.prevent_company_code_update();

create index if not exists requests_company_code_idx on public.requests ("companyCode");
create index if not exists requests_company_code_status_idx on public.requests ("companyCode", status);
create index if not exists requests_target_user_idx on public.requests ("targetUserId");

commit;
