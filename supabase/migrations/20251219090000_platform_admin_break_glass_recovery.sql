-- Break-glass platform admin recovery (one-time reset token)
-- Security goals:
-- - single-use + time-limited reset tokens
-- - token hashes stored at rest (bcrypt via pgcrypto)
-- - no weakening of existing RLS / auth flows
-- - auditable + removable later as one migration

begin;

-- Required for gen_random_bytes(), crypt(), gen_salt(), digest()
create extension if not exists pgcrypto;

-- Note: We intentionally do NOT create a new DB role in a migration.
-- `CREATE ROLE` cannot run inside a transaction block, and migrations are applied transactionally.
-- Instead, we mint a short-lived JWT with role `anon` plus a custom `recovery=true` claim.

-- ------------------------------------------------------------------
-- Users table support
-- ------------------------------------------------------------------
alter table public.users
  add column if not exists force_pin_change boolean not null default false;

-- ------------------------------------------------------------------
-- Reset tokens table (RPC-only; hashed at rest)
-- ------------------------------------------------------------------
create table if not exists public.platform_admin_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists platform_admin_reset_tokens_user_id_idx
  on public.platform_admin_reset_tokens (user_id);

create index if not exists platform_admin_reset_tokens_expires_at_idx
  on public.platform_admin_reset_tokens (expires_at);

alter table public.platform_admin_reset_tokens enable row level security;
alter table public.platform_admin_reset_tokens force row level security;

-- No direct table access from any PostgREST roles; only SECURITY DEFINER RPCs.
revoke all on table public.platform_admin_reset_tokens from public;
revoke all on table public.platform_admin_reset_tokens from anon;
revoke all on table public.platform_admin_reset_tokens from authenticated;
revoke all on table public.platform_admin_reset_tokens from service_role;

-- Allow access only for internal SECURITY DEFINER code paths.
-- This prevents relying on BYPASSRLS and remains inaccessible from PostgREST roles.
drop policy if exists platform_admin_reset_tokens_internal_only on public.platform_admin_reset_tokens;
create policy platform_admin_reset_tokens_internal_only
on public.platform_admin_reset_tokens
as permissive
for all
to public
using (current_user in ('postgres', 'supabase_admin'))
with check (current_user in ('postgres', 'supabase_admin'));

comment on table public.platform_admin_reset_tokens is
  'Break-glass: one-time, 15-minute platform_admin reset tokens (hashed at rest). Access only via SECURITY DEFINER RPCs.';

-- ------------------------------------------------------------------
-- RPC: create_platform_admin_reset_token(target_user_id uuid) -> plaintext token
-- Service-role only. Returns the token once (do not log).
-- ------------------------------------------------------------------
create or replace function public.create_platform_admin_reset_token(target_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  v_token text;
  v_token_hash text;
  v_secret text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_user_id is null then
    raise exception 'invalid target' using errcode = '22023';
  end if;

  perform 1
  from public.users u
  where u.id = target_user_id
    and u.role = 'platform_admin'
    and u.company_code = 'PLATFORM'
    and u.active = true;

  if not found then
    raise exception 'target user not eligible' using errcode = '22023';
  end if;

  -- ≥32 bytes of entropy, safe for copy/paste (hex).
  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := crypt(v_token, gen_salt('bf', 12));

  insert into public.platform_admin_reset_tokens (
    user_id,
    token_hash,
    expires_at,
    used_at,
    created_by
  )
  values (
    target_user_id,
    v_token_hash,
    now() + interval '15 minutes',
    null,
    coalesce(auth.uid()::text, current_setting('request.jwt.claim.sub', true), auth.role())
  );

  return v_token;
end;
$$;

revoke all on function public.create_platform_admin_reset_token(uuid) from public;
revoke all on function public.create_platform_admin_reset_token(uuid) from anon;
revoke all on function public.create_platform_admin_reset_token(uuid) from authenticated;
grant execute on function public.create_platform_admin_reset_token(uuid) to service_role;

comment on function public.create_platform_admin_reset_token(uuid) is
  'Break-glass: service-role-only. Creates a single-use, 15-minute reset token (hashed at rest) and returns plaintext once.';

-- ------------------------------------------------------------------
-- RPC: consume_platform_admin_reset_token(plaintext_token text) -> signed auth response
-- Callable without normal auth; returns a short-lived JWT for the limited DB role
-- `platform_admin_recovery` so the user can set a new PIN and clear force_pin_change.
-- ------------------------------------------------------------------
create or replace function public.consume_platform_admin_reset_token(plaintext_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  v_row record;
  v_jwt_secret text;
  v_now timestamptz := now();
  v_exp int;
  v_access_token text;
  v_header jsonb;
  v_payload jsonb;
  v_header_b64 text;
  v_payload_b64 text;
  v_signing_input text;
  v_sig bytea;
  v_sig_b64 text;
begin
  if plaintext_token is null or length(trim(plaintext_token)) < 32 then
    raise exception 'invalid token' using errcode = '22023';
  end if;

  -- Find and lock a valid (unused + unexpired) token row.
  select t.id, t.user_id
  into v_row
  from public.platform_admin_reset_tokens t
  join public.users u on u.id = t.user_id
  where t.used_at is null
    and t.expires_at > v_now
    and u.role = 'platform_admin'
    and u.company_code = 'PLATFORM'
    and u.active = true
    and t.token_hash = crypt(plaintext_token, t.token_hash)
  for update;

  if not found then
    raise exception 'invalid token' using errcode = '22023';
  end if;

  update public.platform_admin_reset_tokens
  set used_at = v_now
  where id = v_row.id
    and used_at is null;

  if not found then
    raise exception 'invalid token' using errcode = '22023';
  end if;

  update public.users
  set force_pin_change = true
  where id = v_row.user_id;

  v_jwt_secret := current_setting('app.settings.jwt_secret', true);
  if v_jwt_secret is null or v_jwt_secret = '' then
    -- Fail closed: do not allow recovery without a signing secret.
    raise exception 'recovery unavailable' using errcode = '0A000';
  end if;

  -- Short-lived JWT (10 minutes) scoped to a minimal DB role.
  v_exp := floor(extract(epoch from (v_now + interval '10 minutes')))::int;

  -- Mint a minimal HS256 JWT for PostgREST:
  -- - role=anon (no direct table access)
  -- - recovery=true claim gates the recovery-only PIN setter RPC
  v_header := '{"alg":"HS256","typ":"JWT"}'::jsonb;
  v_payload := jsonb_build_object(
    'aud', 'authenticated',
    'role', 'anon',
    'sub', v_row.user_id::text,
    'iat', floor(extract(epoch from v_now))::int,
    'exp', v_exp,
    'recovery', true
  );

  v_header_b64 := regexp_replace(
    translate(encode(convert_to(v_header::text, 'utf8'), 'base64'), '+/', '-_'),
    '=',
    '',
    'g'
  );
  v_payload_b64 := regexp_replace(
    translate(encode(convert_to(v_payload::text, 'utf8'), 'base64'), '+/', '-_'),
    '=',
    '',
    'g'
  );

  v_signing_input := v_header_b64 || '.' || v_payload_b64;
  v_sig := hmac(convert_to(v_signing_input, 'utf8'), convert_to(v_jwt_secret, 'utf8'), 'sha256');
  v_sig_b64 := regexp_replace(translate(encode(v_sig, 'base64'), '+/', '-_'), '=', '', 'g');
  v_access_token := v_signing_input || '.' || v_sig_b64;

  return jsonb_build_object(
    'token_type', 'bearer',
    'access_token', v_access_token,
    'expires_in', 600,
    'user_id', v_row.user_id
  );
end;
$$;

revoke all on function public.consume_platform_admin_reset_token(text) from public;
grant execute on function public.consume_platform_admin_reset_token(text) to anon;
grant execute on function public.consume_platform_admin_reset_token(text) to authenticated;

comment on function public.consume_platform_admin_reset_token(text) is
  'Break-glass: validates a one-time reset token, marks used_at, sets users.force_pin_change=true, returns short-lived recovery JWT.';

-- ------------------------------------------------------------------
-- RPC: platform_admin_recovery_set_pin(new_pin text) -> { ok: true }
-- Uses the short-lived recovery JWT (role=anon + claim recovery=true) to set a new
-- 4-digit PIN (auth password), update users.pinHash, and clear force_pin_change.
-- ------------------------------------------------------------------
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

  if new_pin is null or new_pin !~ '^[0-9]{4}$' then
    raise exception 'invalid pin' using errcode = '22023';
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
  'Break-glass: recovery-JWT-only. Sets new PIN (auth password), updates users.pinHash, clears users.force_pin_change.';

-- ------------------------------------------------------------------
-- RPC: sync_my_pin_hash_and_clear_force_pin_change(new_pin text) -> { ok: true }
-- For normal authenticated sessions: after the client updates the Supabase Auth password,
-- call this to keep public.users.pinHash consistent and clear force_pin_change.
-- ------------------------------------------------------------------
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

  if new_pin is null or new_pin !~ '^[0-9]{4}$' then
    raise exception 'invalid pin' using errcode = '22023';
  end if;

  -- Prevent bypassing `force_pin_change`: require the PIN to match auth.users.
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
