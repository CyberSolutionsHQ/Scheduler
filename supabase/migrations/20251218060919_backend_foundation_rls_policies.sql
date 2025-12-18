-- RLS foundation policies for multi-tenant `company_code` enforcement

begin;

-- ------------------------------------------------------------------
-- Helper functions (Strategy B)
-- ------------------------------------------------------------------
create or replace function public.current_company_code()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.company_code
  from public.users u
  where u.id = auth.uid()
$$;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.role
  from public.users u
  where u.id = auth.uid()
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.current_user_role() = 'platform_admin'
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.current_user_role() = 'manager'
$$;

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select u."employeeId"
  from public.users u
  where u.id = auth.uid()
$$;

-- ------------------------------------------------------------------
-- Enable + force RLS on required tenant tables
-- ------------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.companies force row level security;

alter table public.users enable row level security;
alter table public.users force row level security;

alter table public.employees enable row level security;
alter table public.employees force row level security;

alter table public.job_sites enable row level security;
alter table public.job_sites force row level security;

alter table public.schedules enable row level security;
alter table public.schedules force row level security;

alter table public.shifts enable row level security;
alter table public.shifts force row level security;

alter table public.credential_reset_requests enable row level security;
alter table public.credential_reset_requests force row level security;

-- ------------------------------------------------------------------
-- Drop legacy policies (created before `company_code` standardization)
-- ------------------------------------------------------------------
drop policy if exists companies_service_role_all on public.companies;
drop policy if exists companies_platform_admin_all on public.companies;
drop policy if exists companies_tenant_read_own on public.companies;

drop policy if exists users_service_role_all on public.users;
drop policy if exists users_employee_read_self on public.users;
drop policy if exists users_manager_read_company on public.users;
drop policy if exists users_platform_admin_read_managers on public.users;

drop policy if exists employees_service_role_all on public.employees;
drop policy if exists employees_manager_crud on public.employees;
drop policy if exists employees_employee_read_self on public.employees;

-- `job_sites` was previously `locations` so policy names may still be `locations_*`
drop policy if exists locations_service_role_all on public.job_sites;
drop policy if exists locations_manager_crud on public.job_sites;
drop policy if exists locations_employee_read_company on public.job_sites;

drop policy if exists shifts_service_role_all on public.shifts;
drop policy if exists shifts_manager_crud on public.shifts;
drop policy if exists shifts_employee_read_own_or_crew on public.shifts;

-- ------------------------------------------------------------------
-- companies
-- ------------------------------------------------------------------
create policy companies_service_role_all
on public.companies
as permissive
for all
to service_role
using (true)
with check (true);

create policy companies_platform_admin_all
on public.companies
as permissive
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy companies_tenant_read_own
on public.companies
as permissive
for select
to authenticated
using (company_code = public.current_company_code());

-- ------------------------------------------------------------------
-- users (auth.uid() mapping)
-- ------------------------------------------------------------------
create policy users_service_role_all
on public.users
as permissive
for all
to service_role
using (true)
with check (true);

create policy users_platform_admin_read_all
on public.users
as permissive
for select
to authenticated
using (public.is_platform_admin());

create policy users_manager_read_company
on public.users
as permissive
for select
to authenticated
using (public.is_manager() and company_code = public.current_company_code());

create policy users_employee_read_self
on public.users
as permissive
for select
to authenticated
using (id = auth.uid());

-- ------------------------------------------------------------------
-- employees
-- ------------------------------------------------------------------
create policy employees_service_role_all
on public.employees
as permissive
for all
to service_role
using (true)
with check (true);

create policy employees_platform_admin_all
on public.employees
as permissive
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy employees_manager_crud_company
on public.employees
as permissive
for all
to authenticated
using (public.is_manager() and company_code = public.current_company_code())
with check (public.is_manager() and company_code = public.current_company_code());

create policy employees_employee_read_self
on public.employees
as permissive
for select
to authenticated
using (id = public.current_employee_id() and company_code = public.current_company_code());

-- ------------------------------------------------------------------
-- job_sites
-- ------------------------------------------------------------------
create policy job_sites_service_role_all
on public.job_sites
as permissive
for all
to service_role
using (true)
with check (true);

create policy job_sites_platform_admin_all
on public.job_sites
as permissive
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy job_sites_manager_crud_company
on public.job_sites
as permissive
for all
to authenticated
using (public.is_manager() and company_code = public.current_company_code())
with check (public.is_manager() and company_code = public.current_company_code());

create policy job_sites_employee_read_company
on public.job_sites
as permissive
for select
to authenticated
using (company_code = public.current_company_code());

-- ------------------------------------------------------------------
-- schedules
-- ------------------------------------------------------------------
create policy schedules_service_role_all
on public.schedules
as permissive
for all
to service_role
using (true)
with check (true);

create policy schedules_platform_admin_all
on public.schedules
as permissive
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy schedules_manager_crud_company
on public.schedules
as permissive
for all
to authenticated
using (public.is_manager() and company_code = public.current_company_code())
with check (public.is_manager() and company_code = public.current_company_code());

create policy schedules_employee_read_company
on public.schedules
as permissive
for select
to authenticated
using (company_code = public.current_company_code());

-- ------------------------------------------------------------------
-- shifts
-- ------------------------------------------------------------------
create policy shifts_service_role_all
on public.shifts
as permissive
for all
to service_role
using (true)
with check (true);

create policy shifts_platform_admin_all
on public.shifts
as permissive
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy shifts_manager_crud_company
on public.shifts
as permissive
for all
to authenticated
using (public.is_manager() and company_code = public.current_company_code())
with check (public.is_manager() and company_code = public.current_company_code());

create policy shifts_employee_read_own
on public.shifts
as permissive
for select
to authenticated
using (
  company_code = public.current_company_code()
  and employee_id is not null
  and employee_id = public.current_employee_id()
);

-- ------------------------------------------------------------------
-- credential_reset_requests
-- ------------------------------------------------------------------
create policy credential_reset_requests_service_role_all
on public.credential_reset_requests
as permissive
for all
to service_role
using (true)
with check (true);

create policy credential_reset_requests_platform_admin_all
on public.credential_reset_requests
as permissive
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy credential_reset_requests_manager_read_company
on public.credential_reset_requests
as permissive
for select
to authenticated
using (public.is_manager() and company_code = public.current_company_code());

create policy credential_reset_requests_employee_read_self
on public.credential_reset_requests
as permissive
for select
to authenticated
using (
  company_code = public.current_company_code()
  and (requested_by_user_id = auth.uid() or target_user_id = auth.uid())
);

create policy credential_reset_requests_employee_insert_self
on public.credential_reset_requests
as permissive
for insert
to authenticated
with check (
  company_code = public.current_company_code()
  and public.current_user_role() = 'employee'
  and requested_by_user_id = auth.uid()
  and target_user_id = auth.uid()
  and status = 'pending'
);

create policy credential_reset_requests_manager_insert
on public.credential_reset_requests
as permissive
for insert
to authenticated
with check (
  company_code = public.current_company_code()
  and public.is_manager()
  and requested_by_user_id = auth.uid()
  and status = 'pending'
);

create policy credential_reset_requests_manager_update_company
on public.credential_reset_requests
as permissive
for update
to authenticated
using (public.is_manager() and company_code = public.current_company_code())
with check (public.is_manager() and company_code = public.current_company_code());

commit;
