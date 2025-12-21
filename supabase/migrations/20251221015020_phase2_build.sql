-- Phase 2 build migration
set search_path = public;

create table if not exists "companies" (
  "id" text not null,
  "company_code" text not null,
  "company_name" text not null,
  "is_disabled" boolean default false not null,
  "support_enabled" boolean default false not null,
  "created_at" timestamptz default now() not null,
  constraint "companies_pkey" primary key ("id")
);

alter table "companies" add column if not exists "id" text not null;
alter table "companies" alter column "id" set not null;
alter table "companies" add column if not exists "company_code" text not null;
alter table "companies" alter column "company_code" set not null;
alter table "companies" add column if not exists "company_name" text not null;
alter table "companies" alter column "company_name" set not null;
alter table "companies" add column if not exists "is_disabled" boolean default false not null;
alter table "companies" alter column "is_disabled" set not null;
alter table "companies" alter column "is_disabled" set default false;
alter table "companies" add column if not exists "support_enabled" boolean default false not null;
alter table "companies" alter column "support_enabled" set not null;
alter table "companies" alter column "support_enabled" set default false;
alter table "companies" add column if not exists "created_at" timestamptz default now() not null;
alter table "companies" alter column "created_at" set not null;
alter table "companies" alter column "created_at" set default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'companies'::regclass and contype = 'p') then
    alter table "companies" add constraint "companies_pkey" primary key ("id");
  end if;
end $$;

create unique index if not exists "companies_company_code_key" on "companies" ("company_code");

alter table "companies" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies' and policyname = 'tenant_isolation') then
    create policy "tenant_isolation" on "companies" for all using (company_code = auth.jwt() ->> 'company_code') with check (company_code = auth.jwt() ->> 'company_code');
  end if;
end $$;

create table if not exists "users" (
  "id" text not null,
  "company_code" text not null,
  "username" text not null,
  "role" text not null,
  "employee_id" text,
  "active" boolean default true not null,
  "pin_hash" text not null,
  "force_pin_change" boolean default false not null,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null,
  constraint "users_pkey" primary key ("id")
);

alter table "users" add column if not exists "id" text not null;
alter table "users" alter column "id" set not null;
alter table "users" add column if not exists "company_code" text not null;
alter table "users" alter column "company_code" set not null;
alter table "users" add column if not exists "username" text not null;
alter table "users" alter column "username" set not null;
alter table "users" add column if not exists "role" text not null;
alter table "users" alter column "role" set not null;
alter table "users" add column if not exists "employee_id" text;
alter table "users" add column if not exists "active" boolean default true not null;
alter table "users" alter column "active" set not null;
alter table "users" alter column "active" set default true;
alter table "users" add column if not exists "pin_hash" text not null;
alter table "users" alter column "pin_hash" set not null;
alter table "users" add column if not exists "force_pin_change" boolean default false not null;
alter table "users" alter column "force_pin_change" set not null;
alter table "users" alter column "force_pin_change" set default false;
alter table "users" add column if not exists "created_at" timestamptz default now() not null;
alter table "users" alter column "created_at" set not null;
alter table "users" alter column "created_at" set default now();
alter table "users" add column if not exists "updated_at" timestamptz default now() not null;
alter table "users" alter column "updated_at" set not null;
alter table "users" alter column "updated_at" set default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'users'::regclass and contype = 'p') then
    alter table "users" add constraint "users_pkey" primary key ("id");
  end if;
end $$;

create unique index if not exists "users_company_code_username_key" on "users" ("company_code", "username");

alter table "users" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'tenant_isolation') then
    create policy "tenant_isolation" on "users" for all using (company_code = auth.jwt() ->> 'company_code') with check (company_code = auth.jwt() ->> 'company_code');
  end if;
end $$;

create table if not exists "employees" (
  "id" text not null,
  "company_code" text not null,
  "name" text not null,
  "contact" text,
  "active" boolean default true not null,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null,
  constraint "employees_pkey" primary key ("id")
);

alter table "employees" add column if not exists "id" text not null;
alter table "employees" alter column "id" set not null;
alter table "employees" add column if not exists "company_code" text not null;
alter table "employees" alter column "company_code" set not null;
alter table "employees" add column if not exists "name" text not null;
alter table "employees" alter column "name" set not null;
alter table "employees" add column if not exists "contact" text;
alter table "employees" add column if not exists "active" boolean default true not null;
alter table "employees" alter column "active" set not null;
alter table "employees" alter column "active" set default true;
alter table "employees" add column if not exists "created_at" timestamptz default now() not null;
alter table "employees" alter column "created_at" set not null;
alter table "employees" alter column "created_at" set default now();
alter table "employees" add column if not exists "updated_at" timestamptz default now() not null;
alter table "employees" alter column "updated_at" set not null;
alter table "employees" alter column "updated_at" set default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'employees'::regclass and contype = 'p') then
    alter table "employees" add constraint "employees_pkey" primary key ("id");
  end if;
end $$;

alter table "employees" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employees' and policyname = 'tenant_isolation') then
    create policy "tenant_isolation" on "employees" for all using (company_code = auth.jwt() ->> 'company_code') with check (company_code = auth.jwt() ->> 'company_code');
  end if;
end $$;

create table if not exists "job_sites" (
  "id" text not null,
  "company_code" text not null,
  "name" text not null,
  "address" text,
  "active" boolean default true not null,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null,
  constraint "job_sites_pkey" primary key ("id")
);

alter table "job_sites" add column if not exists "id" text not null;
alter table "job_sites" alter column "id" set not null;
alter table "job_sites" add column if not exists "company_code" text not null;
alter table "job_sites" alter column "company_code" set not null;
alter table "job_sites" add column if not exists "name" text not null;
alter table "job_sites" alter column "name" set not null;
alter table "job_sites" add column if not exists "address" text;
alter table "job_sites" add column if not exists "active" boolean default true not null;
alter table "job_sites" alter column "active" set not null;
alter table "job_sites" alter column "active" set default true;
alter table "job_sites" add column if not exists "created_at" timestamptz default now() not null;
alter table "job_sites" alter column "created_at" set not null;
alter table "job_sites" alter column "created_at" set default now();
alter table "job_sites" add column if not exists "updated_at" timestamptz default now() not null;
alter table "job_sites" alter column "updated_at" set not null;
alter table "job_sites" alter column "updated_at" set default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'job_sites'::regclass and contype = 'p') then
    alter table "job_sites" add constraint "job_sites_pkey" primary key ("id");
  end if;
end $$;

alter table "job_sites" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'job_sites' and policyname = 'tenant_isolation') then
    create policy "tenant_isolation" on "job_sites" for all using (company_code = auth.jwt() ->> 'company_code') with check (company_code = auth.jwt() ->> 'company_code');
  end if;
end $$;

create table if not exists "schedules" (
  "id" text not null,
  "company_code" text,
  "week_start_date" date not null,
  "created_at" timestamptz default now() not null,
  constraint "schedules_pkey" primary key ("id")
);

alter table "schedules" add column if not exists "id" text not null;
alter table "schedules" alter column "id" set not null;
alter table "schedules" add column if not exists "company_code" text;
alter table "schedules" add column if not exists "week_start_date" date not null;
alter table "schedules" alter column "week_start_date" set not null;
alter table "schedules" add column if not exists "created_at" timestamptz default now() not null;
alter table "schedules" alter column "created_at" set not null;
alter table "schedules" alter column "created_at" set default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'schedules'::regclass and contype = 'p') then
    alter table "schedules" add constraint "schedules_pkey" primary key ("id");
  end if;
end $$;

create unique index if not exists "schedules_company_code_week_start_date_key" on "schedules" ("company_code", "week_start_date");

alter table "schedules" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'schedules' and policyname = 'tenant_isolation') then
    create policy "tenant_isolation" on "schedules" for all using (company_code = auth.jwt() ->> 'company_code') with check (company_code = auth.jwt() ->> 'company_code');
  end if;
end $$;

create table if not exists "shifts" (
  "id" text not null,
  "company_code" text not null,
  "schedule_id" text not null,
  "date" date not null,
  "start" time not null,
  "end" time not null,
  "notes" text,
  "loc_id" text not null,
  "emp_id" text,
  "crew_id" text,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null,
  constraint "shifts_pkey" primary key ("id")
);

alter table "shifts" add column if not exists "id" text not null;
alter table "shifts" alter column "id" set not null;
alter table "shifts" add column if not exists "company_code" text not null;
alter table "shifts" alter column "company_code" set not null;
alter table "shifts" add column if not exists "schedule_id" text not null;
alter table "shifts" alter column "schedule_id" set not null;
alter table "shifts" add column if not exists "date" date not null;
alter table "shifts" alter column "date" set not null;
alter table "shifts" add column if not exists "start" time not null;
alter table "shifts" alter column "start" set not null;
alter table "shifts" add column if not exists "end" time not null;
alter table "shifts" alter column "end" set not null;
alter table "shifts" add column if not exists "notes" text;
alter table "shifts" add column if not exists "loc_id" text not null;
alter table "shifts" alter column "loc_id" set not null;
alter table "shifts" add column if not exists "emp_id" text;
alter table "shifts" add column if not exists "crew_id" text;
alter table "shifts" add column if not exists "created_at" timestamptz default now() not null;
alter table "shifts" alter column "created_at" set not null;
alter table "shifts" alter column "created_at" set default now();
alter table "shifts" add column if not exists "updated_at" timestamptz default now() not null;
alter table "shifts" alter column "updated_at" set not null;
alter table "shifts" alter column "updated_at" set default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'shifts'::regclass and contype = 'p') then
    alter table "shifts" add constraint "shifts_pkey" primary key ("id");
  end if;
end $$;

alter table "shifts" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shifts' and policyname = 'tenant_isolation') then
    create policy "tenant_isolation" on "shifts" for all using (company_code = auth.jwt() ->> 'company_code') with check (company_code = auth.jwt() ->> 'company_code');
  end if;
end $$;

create table if not exists "credential_reset_requests" (
  "id" text not null,
  "company_code" text,
  "request_type" text not null,
  "status" text not null,
  "requested_by_user_id" text not null,
  "target_user_id" text not null,
  "created_at" timestamptz default now() not null,
  "resolved_at" timestamptz,
  constraint "credential_reset_requests_pkey" primary key ("id")
);

alter table "credential_reset_requests" add column if not exists "id" text not null;
alter table "credential_reset_requests" alter column "id" set not null;
alter table "credential_reset_requests" add column if not exists "company_code" text;
alter table "credential_reset_requests" add column if not exists "request_type" text not null;
alter table "credential_reset_requests" alter column "request_type" set not null;
alter table "credential_reset_requests" add column if not exists "status" text not null;
alter table "credential_reset_requests" alter column "status" set not null;
alter table "credential_reset_requests" add column if not exists "requested_by_user_id" text not null;
alter table "credential_reset_requests" alter column "requested_by_user_id" set not null;
alter table "credential_reset_requests" add column if not exists "target_user_id" text not null;
alter table "credential_reset_requests" alter column "target_user_id" set not null;
alter table "credential_reset_requests" add column if not exists "created_at" timestamptz default now() not null;
alter table "credential_reset_requests" alter column "created_at" set not null;
alter table "credential_reset_requests" alter column "created_at" set default now();
alter table "credential_reset_requests" add column if not exists "resolved_at" timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'credential_reset_requests'::regclass and contype = 'p') then
    alter table "credential_reset_requests" add constraint "credential_reset_requests_pkey" primary key ("id");
  end if;
end $$;

alter table "credential_reset_requests" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'credential_reset_requests' and policyname = 'tenant_isolation') then
    create policy "tenant_isolation" on "credential_reset_requests" for all using (company_code = auth.jwt() ->> 'company_code') with check (company_code = auth.jwt() ->> 'company_code');
  end if;
end $$;

create table if not exists "requests" (
  "id" text not null,
  "company_code" text not null,
  "type" text not null,
  "status" text not null,
  "requester_user_id" text not null,
  "target_user_id" text not null,
  "proposed_username" text,
  "proposed_pin" text,
  "created_at" timestamptz default now() not null,
  "handled_at" timestamptz,
  "handled_by" text,
  "decision_note" text,
  constraint "requests_pkey" primary key ("id")
);

alter table "requests" add column if not exists "id" text not null;
alter table "requests" alter column "id" set not null;
alter table "requests" add column if not exists "company_code" text not null;
alter table "requests" alter column "company_code" set not null;
alter table "requests" add column if not exists "type" text not null;
alter table "requests" alter column "type" set not null;
alter table "requests" add column if not exists "status" text not null;
alter table "requests" alter column "status" set not null;
alter table "requests" add column if not exists "requester_user_id" text not null;
alter table "requests" alter column "requester_user_id" set not null;
alter table "requests" add column if not exists "target_user_id" text not null;
alter table "requests" alter column "target_user_id" set not null;
alter table "requests" add column if not exists "proposed_username" text;
alter table "requests" add column if not exists "proposed_pin" text;
alter table "requests" add column if not exists "created_at" timestamptz default now() not null;
alter table "requests" alter column "created_at" set not null;
alter table "requests" alter column "created_at" set default now();
alter table "requests" add column if not exists "handled_at" timestamptz;
alter table "requests" add column if not exists "handled_by" text;
alter table "requests" add column if not exists "decision_note" text;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'requests'::regclass and contype = 'p') then
    alter table "requests" add constraint "requests_pkey" primary key ("id");
  end if;
end $$;

alter table "requests" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'requests' and policyname = 'tenant_isolation') then
    create policy "tenant_isolation" on "requests" for all using (company_code = auth.jwt() ->> 'company_code') with check (company_code = auth.jwt() ->> 'company_code');
  end if;
end $$;

create table if not exists "locations" (
  "id" text not null,
  "company_code" text not null,
  "name" text not null,
  "address" text,
  "active" boolean default true not null,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null,
  constraint "locations_pkey" primary key ("id")
);

alter table "locations" add column if not exists "id" text not null;
alter table "locations" alter column "id" set not null;
alter table "locations" add column if not exists "company_code" text not null;
alter table "locations" alter column "company_code" set not null;
alter table "locations" add column if not exists "name" text not null;
alter table "locations" alter column "name" set not null;
alter table "locations" add column if not exists "address" text;
alter table "locations" add column if not exists "active" boolean default true not null;
alter table "locations" alter column "active" set not null;
alter table "locations" alter column "active" set default true;
alter table "locations" add column if not exists "created_at" timestamptz default now() not null;
alter table "locations" alter column "created_at" set not null;
alter table "locations" alter column "created_at" set default now();
alter table "locations" add column if not exists "updated_at" timestamptz default now() not null;
alter table "locations" alter column "updated_at" set not null;
alter table "locations" alter column "updated_at" set default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'locations'::regclass and contype = 'p') then
    alter table "locations" add constraint "locations_pkey" primary key ("id");
  end if;
end $$;

alter table "locations" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'locations' and policyname = 'tenant_isolation') then
    create policy "tenant_isolation" on "locations" for all using (company_code = auth.jwt() ->> 'company_code') with check (company_code = auth.jwt() ->> 'company_code');
  end if;
end $$;

create table if not exists "job_types" (
  "id" text not null,
  "company_code" text not null,
  "name" text not null,
  "active" boolean default true not null,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null,
  constraint "job_types_pkey" primary key ("id")
);

alter table "job_types" add column if not exists "id" text not null;
alter table "job_types" alter column "id" set not null;
alter table "job_types" add column if not exists "company_code" text not null;
alter table "job_types" alter column "company_code" set not null;
alter table "job_types" add column if not exists "name" text not null;
alter table "job_types" alter column "name" set not null;
alter table "job_types" add column if not exists "active" boolean default true not null;
alter table "job_types" alter column "active" set not null;
alter table "job_types" alter column "active" set default true;
alter table "job_types" add column if not exists "created_at" timestamptz default now() not null;
alter table "job_types" alter column "created_at" set not null;
alter table "job_types" alter column "created_at" set default now();
alter table "job_types" add column if not exists "updated_at" timestamptz default now() not null;
alter table "job_types" alter column "updated_at" set not null;
alter table "job_types" alter column "updated_at" set default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'job_types'::regclass and contype = 'p') then
    alter table "job_types" add constraint "job_types_pkey" primary key ("id");
  end if;
end $$;

alter table "job_types" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'job_types' and policyname = 'tenant_isolation') then
    create policy "tenant_isolation" on "job_types" for all using (company_code = auth.jwt() ->> 'company_code') with check (company_code = auth.jwt() ->> 'company_code');
  end if;
end $$;

create table if not exists "crews" (
  "id" text not null,
  "company_code" text not null,
  "name" text not null,
  "active" boolean default true not null,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null,
  constraint "crews_pkey" primary key ("id")
);

alter table "crews" add column if not exists "id" text not null;
alter table "crews" alter column "id" set not null;
alter table "crews" add column if not exists "company_code" text not null;
alter table "crews" alter column "company_code" set not null;
alter table "crews" add column if not exists "name" text not null;
alter table "crews" alter column "name" set not null;
alter table "crews" add column if not exists "active" boolean default true not null;
alter table "crews" alter column "active" set not null;
alter table "crews" alter column "active" set default true;
alter table "crews" add column if not exists "created_at" timestamptz default now() not null;
alter table "crews" alter column "created_at" set not null;
alter table "crews" alter column "created_at" set default now();
alter table "crews" add column if not exists "updated_at" timestamptz default now() not null;
alter table "crews" alter column "updated_at" set not null;
alter table "crews" alter column "updated_at" set default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'crews'::regclass and contype = 'p') then
    alter table "crews" add constraint "crews_pkey" primary key ("id");
  end if;
end $$;

alter table "crews" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crews' and policyname = 'tenant_isolation') then
    create policy "tenant_isolation" on "crews" for all using (company_code = auth.jwt() ->> 'company_code') with check (company_code = auth.jwt() ->> 'company_code');
  end if;
end $$;

create table if not exists "crew_members" (
  "id" text not null,
  "company_code" text not null,
  "crew_id" text not null,
  "employee_id" text not null,
  "created_at" timestamptz default now() not null,
  constraint "crew_members_pkey" primary key ("id")
);

alter table "crew_members" add column if not exists "id" text not null;
alter table "crew_members" alter column "id" set not null;
alter table "crew_members" add column if not exists "company_code" text not null;
alter table "crew_members" alter column "company_code" set not null;
alter table "crew_members" add column if not exists "crew_id" text not null;
alter table "crew_members" alter column "crew_id" set not null;
alter table "crew_members" add column if not exists "employee_id" text not null;
alter table "crew_members" alter column "employee_id" set not null;
alter table "crew_members" add column if not exists "created_at" timestamptz default now() not null;
alter table "crew_members" alter column "created_at" set not null;
alter table "crew_members" alter column "created_at" set default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'crew_members'::regclass and contype = 'p') then
    alter table "crew_members" add constraint "crew_members_pkey" primary key ("id");
  end if;
end $$;

create unique index if not exists "crew_members_crew_id_employee_id_key" on "crew_members" ("crew_id", "employee_id");

alter table "crew_members" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crew_members' and policyname = 'tenant_isolation') then
    create policy "tenant_isolation" on "crew_members" for all using (company_code = auth.jwt() ->> 'company_code') with check (company_code = auth.jwt() ->> 'company_code');
  end if;
end $$;

create table if not exists "shift_jobs" (
  "id" text not null,
  "company_code" text not null,
  "shift_id" text not null,
  "job_type_id" text not null,
  "created_at" timestamptz default now() not null,
  constraint "shift_jobs_pkey" primary key ("id")
);

alter table "shift_jobs" add column if not exists "id" text not null;
alter table "shift_jobs" alter column "id" set not null;
alter table "shift_jobs" add column if not exists "company_code" text not null;
alter table "shift_jobs" alter column "company_code" set not null;
alter table "shift_jobs" add column if not exists "shift_id" text not null;
alter table "shift_jobs" alter column "shift_id" set not null;
alter table "shift_jobs" add column if not exists "job_type_id" text not null;
alter table "shift_jobs" alter column "job_type_id" set not null;
alter table "shift_jobs" add column if not exists "created_at" timestamptz default now() not null;
alter table "shift_jobs" alter column "created_at" set not null;
alter table "shift_jobs" alter column "created_at" set default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'shift_jobs'::regclass and contype = 'p') then
    alter table "shift_jobs" add constraint "shift_jobs_pkey" primary key ("id");
  end if;
end $$;

create unique index if not exists "shift_jobs_shift_id_job_type_id_key" on "shift_jobs" ("shift_id", "job_type_id");

alter table "shift_jobs" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shift_jobs' and policyname = 'tenant_isolation') then
    create policy "tenant_isolation" on "shift_jobs" for all using (company_code = auth.jwt() ->> 'company_code') with check (company_code = auth.jwt() ->> 'company_code');
  end if;
end $$;
