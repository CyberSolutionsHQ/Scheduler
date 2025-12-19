# Break-Glass Platform Admin Recovery (Cloud-Only)

Target project: `xwroayzhbbwbiuswtuvs.supabase.co`

Hard rules:
- Do **not** use Docker/local `supabase start`.
- Do **not** paste/log/commit PINs, plaintext tokens, JWTs, anon keys, or service role keys.

## Deploy (Supabase Cloud)

### Option A: Dashboard → SQL Editor
Run the migration SQL from:
- `supabase/migrations/20251219090000_platform_admin_break_glass_recovery.sql`

### Option B: Supabase CLI (cloud-linked only)
1) `supabase login`
2) `supabase link --project-ref xwroayzhbbwbiuswtuvs`
3) `supabase db push`

## What Gets Created

### Table
- `public.platform_admin_reset_tokens`
  - `token_hash` (bcrypt via `pgcrypto.crypt()`)
  - `expires_at` (15 minutes)
  - `used_at` (single-use)
  - RLS enabled + forced
  - No direct table privileges for `anon`/`authenticated`/`service_role`
  - Internal-only RLS policy so only SECURITY DEFINER code paths can touch it

### Columns
- `public.users.force_pin_change boolean not null default false` (added if missing)

### RPCs (SECURITY DEFINER)
- `public.create_platform_admin_reset_token(target_user_id uuid) returns text`
  - **service_role only**
  - Verifies `public.users.role = 'platform_admin'` and `company_code = 'PLATFORM'`
  - Returns plaintext token **once** (hash stored at rest)
- `public.consume_platform_admin_reset_token(plaintext_token text) returns jsonb`
  - Callable from `anon`/`authenticated`
  - Marks token `used_at`, sets `users.force_pin_change = true`
  - Returns a short-lived PostgREST JWT (`role=anon`, `recovery=true`)
- `public.platform_admin_recovery_set_pin(new_pin text) returns jsonb`
  - Callable only with the short-lived recovery JWT (`recovery=true`)
  - Sets new PIN by updating `auth.users.encrypted_password` and syncs `public.users."pinHash"`
- `public.sync_my_pin_hash_and_clear_force_pin_change(new_pin text) returns jsonb`
  - Normal authenticated flow helper after `supabase.auth.updateUser({ password })`

## Minimal Frontend Usage (Deployed UI)

The login page includes a hidden recovery path:
- Open: `https://cybersolutionshq.github.io/Scheduler/login.html?recovery=1`
- Click “Use recovery token”, paste token, continue
- Set new PIN immediately (token/JWT never stored; in-memory only)

## Cloud Sanity Checks (Manual)

These must be run by a human with Dashboard/API access. Record PASS/FAIL.

1) Token Creation
- Find a real platform admin user id in SQL editor:
  - `select id, username, role, company_code from public.users where role = 'platform_admin' and company_code = 'PLATFORM';`
- Call `create_platform_admin_reset_token(<user_id>)` **using service_role** (via RPC/API).
- Verify row exists (SQL editor):
  - `token_hash` present
  - `expires_at` ≈ now + 15 min
  - `used_at is null`

2) Token Consumption (UI)
- Use the token once via the deployed UI recovery flow.
- Verify (SQL editor):
  - token row has `used_at` set
  - `public.users.force_pin_change = true` for that user (before PIN is set) and then cleared after PIN set

3) Token Reuse
- Attempt to reuse the same token in the UI.
- Must fail with a generic “invalid token”.

4) Token Expiry
- Generate a new token.
- Force expiry in SQL editor:
  - `update public.platform_admin_reset_tokens set expires_at = now() - interval '1 minute' where user_id = '<user_id>' and used_at is null;`
- Attempt consume; must fail.

5) Invalid Token
- Use a random string; must fail.

6) Role Protection
- Attempt token creation for a non-`platform_admin` user id; must fail.

7) RLS/Privileges Enforcement
- Attempt direct table read via PostgREST as anon/authenticated.
- Must be denied (no grants + RLS forced).

## Removal (After Recovery)

Create a follow-up migration (or run via SQL editor) to remove the break-glass path:
- `drop function if exists public.create_platform_admin_reset_token(uuid);`
- `drop function if exists public.consume_platform_admin_reset_token(text);`
- `drop function if exists public.platform_admin_recovery_set_pin(text);`
- `drop table if exists public.platform_admin_reset_tokens;`
- Keep `users.force_pin_change` only if you still want forced PIN rotation support.

