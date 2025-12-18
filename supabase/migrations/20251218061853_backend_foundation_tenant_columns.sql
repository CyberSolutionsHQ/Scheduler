-- Ensure every tenant table includes `company_code` and tighten key references.

begin;

-- Ensure reserved PLATFORM company exists (required to support platform_admin context).
insert into public.companies ("companyCode", "companyName")
values ('PLATFORM', 'Platform')
on conflict ("companyCode") do nothing;

-- ------------------------------------------------------------------
-- Add `company_code` generated columns to remaining tenant tables
-- ------------------------------------------------------------------
alter table public.job_types
  add column if not exists company_code text generated always as ("companyCode") stored;

alter table public.crews
  add column if not exists company_code text generated always as ("companyCode") stored;

alter table public.crew_members
  add column if not exists company_code text generated always as ("companyCode") stored;

alter table public.shift_jobs
  add column if not exists company_code text generated always as ("companyCode") stored;

alter table public.requests
  add column if not exists company_code text generated always as ("companyCode") stored;

-- ------------------------------------------------------------------
-- Foreign keys (safe baseline)
-- ------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_company_code_fk_v2') then
    alter table public.users
      add constraint users_company_code_fk_v2
      foreign key (company_code)
      references public.companies (company_code)
      on delete restrict
      not valid;
    alter table public.users validate constraint users_company_code_fk_v2;
  end if;
end $$;

commit;
