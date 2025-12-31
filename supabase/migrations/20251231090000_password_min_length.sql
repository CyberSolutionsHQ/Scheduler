begin;

-- Update auth password validation to enforce minimum length 8.
create or replace function public.platform_admin_recovery_set_pin(new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  v_user_id uuid;
  v_company_code text;
  v_username text;
  v_pin_hash text;
begin
  if auth.role() is distinct from 'anon' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if current_setting('request.jwt.claim.recovery', true) is distinct from 'true' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if new_pin is null or char_length(new_pin) < 8 then
    raise exception 'invalid password' using errcode = '22023';
  end if;

  select u.company_code, u.username
  into v_company_code, v_username
  from public.users u
  where u.id = v_user_id
    and u.role = 'platform_admin'
    and u.company_code = 'PLATFORM'
    and u.active = true
    and u.force_pin_change = true;

  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Update Supabase Auth password (bcrypt).
  update auth.users
  set encrypted_password = crypt(new_pin, gen_salt('bf', 12)),
      updated_at = now()
  where id = v_user_id;

  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Keep app-level pinHash in sync with the auth password.
  v_pin_hash := encode(
    digest(convert_to(v_company_code || ':' || v_username || ':' || new_pin, 'utf8'), 'sha256'),
    'hex'
  );

  update public.users
  set "pinHash" = v_pin_hash,
      force_pin_change = false
  where id = v_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.platform_admin_recovery_set_pin(text) from public;
grant execute on function public.platform_admin_recovery_set_pin(text) to anon;

comment on function public.platform_admin_recovery_set_pin(text) is
  'Break-glass: recovery-JWT-only. Sets new password (auth password), updates users.pinHash, clears users.force_pin_change.';

create or replace function public.sync_my_pin_hash_and_clear_force_pin_change(new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  v_user_id uuid;
  v_company_code text;
  v_username text;
  v_pin_hash text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if new_pin is null or char_length(new_pin) < 8 then
    raise exception 'invalid password' using errcode = '22023';
  end if;

  -- Prevent bypassing `force_pin_change`: require the password to match auth.users.
  perform 1
  from auth.users au
  where au.id = v_user_id
    and au.encrypted_password = crypt(new_pin, au.encrypted_password);

  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select u.company_code, u.username
  into v_company_code, v_username
  from public.users u
  where u.id = v_user_id
    and u.active = true;

  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_pin_hash := encode(
    digest(convert_to(v_company_code || ':' || v_username || ':' || new_pin, 'utf8'), 'sha256'),
    'hex'
  );

  update public.users
  set "pinHash" = v_pin_hash,
      force_pin_change = false
  where id = v_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.sync_my_pin_hash_and_clear_force_pin_change(text) from public;
grant execute on function public.sync_my_pin_hash_and_clear_force_pin_change(text) to authenticated;

comment on function public.sync_my_pin_hash_and_clear_force_pin_change(text) is
  'Keeps users.pinHash in sync after auth password update; clears users.force_pin_change for the current user.';

commit;
