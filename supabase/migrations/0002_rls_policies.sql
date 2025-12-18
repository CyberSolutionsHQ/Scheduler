-- RLS + policies for Cyber Solutions LLC Schedule Manager (per HANDOFF_SUPABASE_CONTRACT.md)

begin;

-- Helper functions (stable)
create or replace function public.current_company_code()
returns text
language sql
stable
as $$
  select u."companyCode"
  from public.users u
  where u.id = auth.uid()
$$;

create or replace function public.current_role()
returns public.user_role
language sql
stable
as $$
  select u.role
  from public.users u
  where u.id = auth.uid()
$$;

create or replace function public.current_employee_id()
returns uuid
language sql
stable
as $$
  select u."employeeId"
  from public.users u
  where u.id = auth.uid()
$$;

create or replace function public.current_user_active()
returns boolean
language sql
stable
as $$
  select coalesce(u.active, false)
  from public.users u
  where u.id = auth.uid()
$$;

create or replace function public.company_is_active(code text)
returns boolean
language sql
stable
as $$
  select
    case
      when code is null then false
      when code = 'PLATFORM' then true
      else exists (
        select 1
        from public.companies c
        where c."companyCode" = code
          and c."isDisabled" = false
      )
    end
$$;

create or replace function public.current_company_is_active()
returns boolean
language sql
stable
as $$
  select public.company_is_active(public.current_company_code())
$$;

-- Enable and force RLS on all tables
alter table public.companies enable row level security;
alter table public.companies force row level security;

alter table public.users enable row level security;
alter table public.users force row level security;

alter table public.employees enable row level security;
alter table public.employees force row level security;

alter table public.locations enable row level security;
alter table public.locations force row level security;

alter table public.job_types enable row level security;
alter table public.job_types force row level security;

alter table public.crews enable row level security;
alter table public.crews force row level security;

alter table public.crew_members enable row level security;
alter table public.crew_members force row level security;

alter table public.shifts enable row level security;
alter table public.shifts force row level security;

alter table public.shift_jobs enable row level security;
alter table public.shift_jobs force row level security;

alter table public.requests enable row level security;
alter table public.requests force row level security;

-- ------------------------------------------------------------------
-- companies
-- ------------------------------------------------------------------
drop policy if exists companies_service_role_all on public.companies;
create policy companies_service_role_all
on public.companies
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists companies_platform_admin_all on public.companies;
create policy companies_platform_admin_all
on public.companies
as permissive
for all
to authenticated
using (public.current_role() = 'platform_admin' and public.current_user_active())
with check (public.current_role() = 'platform_admin' and public.current_user_active());

drop policy if exists companies_tenant_read_own on public.companies;
create policy companies_tenant_read_own
on public.companies
as permissive
for select
to authenticated
using (
  public.current_role() in ('manager', 'employee')
  and public.current_user_active()
  and "companyCode" = public.current_company_code()
);

-- ------------------------------------------------------------------
-- users (auth.uid() mapping)
-- ------------------------------------------------------------------
drop policy if exists users_service_role_all on public.users;
create policy users_service_role_all
on public.users
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists users_employee_read_self on public.users;
create policy users_employee_read_self
on public.users
as permissive
for select
to authenticated
using (id = auth.uid());

drop policy if exists users_manager_read_company on public.users;
create policy users_manager_read_company
on public.users
as permissive
for select
to authenticated
using (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
);

drop policy if exists users_platform_admin_read_managers on public.users;
create policy users_platform_admin_read_managers
on public.users
as permissive
for select
to authenticated
using (
  public.current_role() = 'platform_admin'
  and public.current_user_active()
  and (role = 'manager' or "companyCode" = 'PLATFORM')
);

-- No client-side writes to users (Edge Functions only, via service_role)

-- ------------------------------------------------------------------
-- employees
-- ------------------------------------------------------------------
drop policy if exists employees_service_role_all on public.employees;
create policy employees_service_role_all
on public.employees
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists employees_manager_crud on public.employees;
create policy employees_manager_crud
on public.employees
as permissive
for all
to authenticated
using (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
)
with check (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
);

drop policy if exists employees_employee_read_self on public.employees;
create policy employees_employee_read_self
on public.employees
as permissive
for select
to authenticated
using (
  public.current_role() = 'employee'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
  and id = public.current_employee_id()
);

-- ------------------------------------------------------------------
-- locations
-- ------------------------------------------------------------------
drop policy if exists locations_service_role_all on public.locations;
create policy locations_service_role_all
on public.locations
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists locations_manager_crud on public.locations;
create policy locations_manager_crud
on public.locations
as permissive
for all
to authenticated
using (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
)
with check (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
);

drop policy if exists locations_employee_read_company on public.locations;
create policy locations_employee_read_company
on public.locations
as permissive
for select
to authenticated
using (
  public.current_role() = 'employee'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
);

-- ------------------------------------------------------------------
-- job_types
-- ------------------------------------------------------------------
drop policy if exists job_types_service_role_all on public.job_types;
create policy job_types_service_role_all
on public.job_types
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists job_types_manager_crud on public.job_types;
create policy job_types_manager_crud
on public.job_types
as permissive
for all
to authenticated
using (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
)
with check (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
);

drop policy if exists job_types_employee_read_company on public.job_types;
create policy job_types_employee_read_company
on public.job_types
as permissive
for select
to authenticated
using (
  public.current_role() = 'employee'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
);

-- ------------------------------------------------------------------
-- crews
-- ------------------------------------------------------------------
drop policy if exists crews_service_role_all on public.crews;
create policy crews_service_role_all
on public.crews
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists crews_manager_crud on public.crews;
create policy crews_manager_crud
on public.crews
as permissive
for all
to authenticated
using (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
)
with check (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
);

drop policy if exists crews_employee_read_memberships on public.crews;
create policy crews_employee_read_memberships
on public.crews
as permissive
for select
to authenticated
using (
  public.current_role() = 'employee'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
  and exists (
    select 1
    from public.crew_members cm
    where cm."companyCode" = public.crews."companyCode"
      and cm."crewId" = public.crews.id
      and cm."employeeId" = public.current_employee_id()
  )
);

-- ------------------------------------------------------------------
-- crew_members
-- ------------------------------------------------------------------
drop policy if exists crew_members_service_role_all on public.crew_members;
create policy crew_members_service_role_all
on public.crew_members
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists crew_members_manager_crud on public.crew_members;
create policy crew_members_manager_crud
on public.crew_members
as permissive
for all
to authenticated
using (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
)
with check (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
);

drop policy if exists crew_members_employee_read_self_membership on public.crew_members;
create policy crew_members_employee_read_self_membership
on public.crew_members
as permissive
for select
to authenticated
using (
  public.current_role() = 'employee'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
  and "employeeId" = public.current_employee_id()
);

-- ------------------------------------------------------------------
-- shifts
-- ------------------------------------------------------------------
drop policy if exists shifts_service_role_all on public.shifts;
create policy shifts_service_role_all
on public.shifts
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists shifts_manager_crud on public.shifts;
create policy shifts_manager_crud
on public.shifts
as permissive
for all
to authenticated
using (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
)
with check (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
);

drop policy if exists shifts_employee_read_own_or_crew on public.shifts;
create policy shifts_employee_read_own_or_crew
on public.shifts
as permissive
for select
to authenticated
using (
  public.current_role() = 'employee'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
  and (
    "empId" = public.current_employee_id()
    or exists (
      select 1
      from public.crew_members cm
      where cm."companyCode" = public.shifts."companyCode"
        and cm."crewId" = public.shifts."crewId"
        and cm."employeeId" = public.current_employee_id()
    )
  )
);

-- ------------------------------------------------------------------
-- shift_jobs
-- ------------------------------------------------------------------
drop policy if exists shift_jobs_service_role_all on public.shift_jobs;
create policy shift_jobs_service_role_all
on public.shift_jobs
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists shift_jobs_manager_crud on public.shift_jobs;
create policy shift_jobs_manager_crud
on public.shift_jobs
as permissive
for all
to authenticated
using (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
)
with check (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
);

drop policy if exists shift_jobs_employee_read_allowed_shifts on public.shift_jobs;
create policy shift_jobs_employee_read_allowed_shifts
on public.shift_jobs
as permissive
for select
to authenticated
using (
  public.current_role() = 'employee'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
  and exists (
    select 1
    from public.shifts s
    where s."companyCode" = public.shift_jobs."companyCode"
      and s.id = public.shift_jobs."shiftId"
      and (
        s."empId" = public.current_employee_id()
        or exists (
          select 1
          from public.crew_members cm
          where cm."companyCode" = s."companyCode"
            and cm."crewId" = s."crewId"
            and cm."employeeId" = public.current_employee_id()
        )
      )
  )
);

-- ------------------------------------------------------------------
-- requests (credential-change workflow)
-- ------------------------------------------------------------------
drop policy if exists requests_service_role_all on public.requests;
create policy requests_service_role_all
on public.requests
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists requests_platform_admin_read_all on public.requests;
create policy requests_platform_admin_read_all
on public.requests
as permissive
for select
to authenticated
using (
  public.current_role() = 'platform_admin'
  and public.current_user_active()
  and (
    type = 'manager_change_credentials'
    or (type = 'admin_change_credentials' and "companyCode" = 'PLATFORM')
  )
);

drop policy if exists requests_manager_read_company on public.requests;
create policy requests_manager_read_company
on public.requests
as permissive
for select
to authenticated
using (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
  and (
    type = 'employee_change_credentials'
    or "requesterUserId" = auth.uid()
    or "targetUserId" = auth.uid()
  )
);

drop policy if exists requests_employee_read_self on public.requests;
create policy requests_employee_read_self
on public.requests
as permissive
for select
to authenticated
using (
  public.current_role() = 'employee'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
  and ("requesterUserId" = auth.uid() or "targetUserId" = auth.uid())
);

drop policy if exists requests_employee_insert_self on public.requests;
create policy requests_employee_insert_self
on public.requests
as permissive
for insert
to authenticated
with check (
  public.current_role() = 'employee'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
  and type = 'employee_change_credentials'
  and status = 'pending'
  and "requesterUserId" = auth.uid()
  and "targetUserId" = auth.uid()
);

drop policy if exists requests_manager_insert_self on public.requests;
create policy requests_manager_insert_self
on public.requests
as permissive
for insert
to authenticated
with check (
  public.current_role() = 'manager'
  and public.current_user_active()
  and public.current_company_is_active()
  and "companyCode" = public.current_company_code()
  and type = 'manager_change_credentials'
  and status = 'pending'
  and "requesterUserId" = auth.uid()
  and "targetUserId" = auth.uid()
);

drop policy if exists requests_platform_admin_insert_self on public.requests;
create policy requests_platform_admin_insert_self
on public.requests
as permissive
for insert
to authenticated
with check (
  public.current_role() = 'platform_admin'
  and "companyCode" = 'PLATFORM'
  and type = 'admin_change_credentials'
  and status = 'pending'
  and "requesterUserId" = auth.uid()
  and "targetUserId" = auth.uid()
);

-- No client-side updates/deletes to requests (Edge Functions only, via service_role)

commit;
