-- Data cleanup: remove any stale platform admin records for reserved company PLATFORM.
-- Safe to re-run (idempotent).

begin;

do $$
declare
  v_before int := 0;
  v_after int := 0;
begin
  select count(*) into v_before
  from public.users
  where role = 'platform_admin'
    and "companyCode" = 'PLATFORM';

  -- Legacy table: avoid FK violations when deleting platform admin user rows.
  if to_regclass('public.requests') is not null then
    update public.requests
    set "handledBy" = null
    where "handledBy" in (
      select id
      from public.users
      where role = 'platform_admin'
        and "companyCode" = 'PLATFORM'
    );
  end if;

  -- If auth users still exist for these ids, delete them first (may cascade).
  delete from auth.users
  where id in (
    select id
    from public.users
    where role = 'platform_admin'
      and "companyCode" = 'PLATFORM'
  );

  -- Delete any remaining app-level user rows (cascades to related app tables via FKs).
  delete from public.users
  where role = 'platform_admin'
    and "companyCode" = 'PLATFORM';

  select count(*) into v_after
  from public.users
  where role = 'platform_admin'
    and "companyCode" = 'PLATFORM';

  raise notice 'Cleanup PLATFORM platform_admin users: before=% after=%', v_before, v_after;
end $$;

commit;
