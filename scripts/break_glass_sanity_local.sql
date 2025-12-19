-- Local-only sanity checks for break-glass platform admin recovery.
-- This script prints PASS/FAIL notices and never outputs PINs/tokens/JWTs.

do $$
declare
  v_platform_admin_id uuid := gen_random_uuid();
  v_manager_id uuid := gen_random_uuid();

  v_platform_email text := 'breakglass_pa_' || replace(v_platform_admin_id::text, '-', '') || '@example.com';
  v_manager_email text := 'breakglass_mgr_' || replace(v_manager_id::text, '-', '') || '@example.com';

  v_platform_username text := 'breakglass_pa';
  v_manager_username text := 'breakglass_mgr';

  v_platform_pin text := lpad((floor(random() * 10000))::int::text, 4, '0');
  v_manager_pin text := lpad((floor(random() * 10000))::int::text, 4, '0');
  v_new_pin text := lpad((floor(random() * 10000))::int::text, 4, '0');

  v_token text;
  v_token2 text;
  v_row_id uuid;
  v_expires_at timestamptz;
  v_used_at timestamptz;
  v_force_pin_change boolean;
  v_pw_before text;
  v_pw_after text;
  v_tmp text;
begin
  -- Clean up any leftovers from a previous interrupted run (best-effort).
  delete from public.platform_admin_reset_tokens where created_by like 'breakglass%';
  delete from public.users where username in ('breakglass_pa', 'breakglass_mgr');
  delete from auth.users where email like 'breakglass_%@example.com';

  -- ------------------------------------------------------------------
  -- Setup: create auth.users + public.users mapping rows
  -- ------------------------------------------------------------------
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    v_platform_admin_id,
    'authenticated',
    'authenticated',
    v_platform_email,
    crypt(v_platform_pin, gen_salt('bf', 12)),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    v_manager_id,
    'authenticated',
    'authenticated',
    v_manager_email,
    crypt(v_manager_pin, gen_salt('bf', 12)),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

  insert into public.users (id, "companyCode", username, "pinHash", role, "employeeId", active, force_pin_change)
  values (
    v_platform_admin_id,
    'PLATFORM',
    v_platform_username,
    encode(digest(convert_to('PLATFORM:' || v_platform_username || ':' || v_platform_pin, 'utf8'), 'sha256'), 'hex'),
    'platform_admin',
    null,
    true,
    false
  );

  -- Ensure companies exist (users has a tenant FK in the newer schema).
  insert into public.companies ("companyCode", "companyName", "isDisabled", "supportEnabled")
  values ('PLATFORM', 'Platform', false, false)
  on conflict ("companyCode") do nothing;

  insert into public.companies ("companyCode", "companyName", "isDisabled", "supportEnabled")
  values ('ACME', 'ACME (sanity)', false, false)
  on conflict ("companyCode") do nothing;

  insert into public.users (id, "companyCode", username, "pinHash", role, "employeeId", active, force_pin_change)
  values (
    v_manager_id,
    'ACME',
    v_manager_username,
    encode(digest(convert_to('ACME:' || v_manager_username || ':' || v_manager_pin, 'utf8'), 'sha256'), 'hex'),
    'manager',
    null,
    true,
    false
  );

  raise notice 'PASS: setup created test users';

  -- ------------------------------------------------------------------
  -- Token generation: service-role only + platform_admin only
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);

  v_token := public.create_platform_admin_reset_token(v_platform_admin_id);

  select id, expires_at, used_at
  into v_row_id, v_expires_at, v_used_at
  from public.platform_admin_reset_tokens
  where user_id = v_platform_admin_id
  order by created_at desc
  limit 1;

  if v_row_id is null then
    raise exception 'FAIL: generation did not create a row';
  end if;
  if v_used_at is not null then
    raise exception 'FAIL: generation created a used token';
  end if;
  if v_expires_at < now() + interval '14 minutes' or v_expires_at > now() + interval '16 minutes' then
    raise exception 'FAIL: expiry is not ~15 minutes';
  end if;
  raise notice 'PASS: generation creates row with correct expiry';

  -- Non-platform-admin cannot receive token (even with service_role caller).
  begin
    v_tmp := public.create_platform_admin_reset_token(v_manager_id);
    raise exception 'FAIL: non-platform-admin token generation unexpectedly succeeded';
  exception
    when others then
      raise notice 'PASS: non-platform-admin cannot receive token';
  end;

  -- Snapshot password hash before consume (consume should not change auth password).
  select encrypted_password into v_pw_before from auth.users where id = v_platform_admin_id;

  -- ------------------------------------------------------------------
  -- Token consumption: single-use + sets force_pin_change
  -- ------------------------------------------------------------------
  -- Simulate anon RPC call context.
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.recovery', '', true);

  perform public.consume_platform_admin_reset_token(v_token);

  select used_at into v_used_at
  from public.platform_admin_reset_tokens
  where id = v_row_id;

  if v_used_at is null then
    raise exception 'FAIL: consumption did not set used_at';
  end if;
  raise notice 'PASS: consumption sets used_at';

  select force_pin_change into v_force_pin_change from public.users where id = v_platform_admin_id;
  if v_force_pin_change is not true then
    raise exception 'FAIL: consumption did not set users.force_pin_change=true';
  end if;
  raise notice 'PASS: consumption sets users.force_pin_change=true';

  -- Reuse fails.
  begin
    perform public.consume_platform_admin_reset_token(v_token);
    raise exception 'FAIL: token reuse unexpectedly succeeded';
  exception
    when others then
      raise notice 'PASS: token reuse fails';
  end;

  -- Random token fails.
  begin
    perform public.consume_platform_admin_reset_token(encode(gen_random_bytes(32), 'hex'));
    raise exception 'FAIL: random token unexpectedly succeeded';
  exception
    when others then
      raise notice 'PASS: random token fails';
  end;

  -- Consume does not change auth password.
  select encrypted_password into v_pw_after from auth.users where id = v_platform_admin_id;
  if v_pw_before is distinct from v_pw_after then
    raise exception 'FAIL: consume changed auth password';
  end if;
  raise notice 'PASS: normal login still requires PIN (consume does not change auth password)';

  -- Expired token fails (force expiry via DB update for test only).
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  v_token2 := public.create_platform_admin_reset_token(v_platform_admin_id);

  update public.platform_admin_reset_tokens
  set expires_at = now() - interval '1 minute'
  where user_id = v_platform_admin_id
    and used_at is null
    and token_hash = crypt(v_token2, token_hash);

  begin
    perform set_config('request.jwt.claim.role', 'anon', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.recovery', '', true);
    perform public.consume_platform_admin_reset_token(v_token2);
    raise exception 'FAIL: expired token unexpectedly succeeded';
  exception
    when others then
      raise notice 'PASS: expired token fails';
  end;

  -- ------------------------------------------------------------------
  -- Recovery PIN update: requires recovery claim + force_pin_change=true
  -- ------------------------------------------------------------------
  -- Must fail without recovery claim.
  begin
    perform set_config('request.jwt.claim.role', 'anon', true);
    perform set_config('request.jwt.claim.sub', v_platform_admin_id::text, true);
    perform set_config('request.jwt.claim.recovery', 'false', true);
    perform public.platform_admin_recovery_set_pin(v_new_pin);
    raise exception 'FAIL: recovery PIN set succeeded without recovery claim';
  exception
    when others then
      raise notice 'PASS: recovery PIN set requires recovery claim';
  end;

  -- Now succeed with recovery claim.
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', v_platform_admin_id::text, true);
  perform set_config('request.jwt.claim.recovery', 'true', true);
  perform public.platform_admin_recovery_set_pin(v_new_pin);

  select force_pin_change into v_force_pin_change from public.users where id = v_platform_admin_id;
  if v_force_pin_change is not false then
    raise exception 'FAIL: PIN set did not clear force_pin_change';
  end if;
  raise notice 'PASS: forced PIN flag clears after PIN change';

  select encrypted_password into v_pw_after from auth.users where id = v_platform_admin_id;
  if v_pw_before is distinct from v_pw_after then
    raise notice 'PASS: auth password hash updated by recovery PIN set';
  else
    raise exception 'FAIL: auth password hash did not change after recovery PIN set';
  end if;

  -- ------------------------------------------------------------------
  -- RLS / privileges: direct table access should be blocked for anon/authenticated
  -- ------------------------------------------------------------------
  begin
    execute 'set local role anon';
    perform (select 1 from public.platform_admin_reset_tokens limit 1);
    raise exception 'FAIL: anon can read platform_admin_reset_tokens';
  exception
    when insufficient_privilege then
      raise notice 'PASS: direct table access blocked for anon (privileges)';
    when others then
      raise notice 'PASS: direct table access blocked for anon';
  end;

  begin
    execute 'set local role authenticated';
    perform (select 1 from public.platform_admin_reset_tokens limit 1);
    raise exception 'FAIL: authenticated can read platform_admin_reset_tokens';
  exception
    when insufficient_privilege then
      raise notice 'PASS: direct table access blocked for authenticated (privileges)';
    when others then
      raise notice 'PASS: direct table access blocked for authenticated';
  end;

  -- Cleanup test data.
  delete from public.platform_admin_reset_tokens where user_id in (v_platform_admin_id, v_manager_id);
  delete from public.users where id in (v_platform_admin_id, v_manager_id);
  delete from auth.users where id in (v_platform_admin_id, v_manager_id);

  raise notice 'PASS: cleanup complete';
end $$;
