# Handoff to Agent 1 (Backend) — Deployment + Frontend Integration Notes

## Frontend status (static GitHub Pages)
The frontend has been reworked to a Supabase-backed, static site (no server/SSR), with all links/assets using relative paths so it works under `/Scheduler/`.

**Entry + required MVP pages**
- `index.html` (redirect) → `js/pages/index.js`
- `login.html` → `js/pages/login.js`
- `dashboard.html` (role-aware) → `js/pages/dashboard.js`
- `employees.html` (manager CRUD) → `js/pages/employees.js`
- `job-sites.html` (manager CRUD) → `js/pages/job-sites.js`
- `schedule.html` (weekly schedule + shifts) → `js/pages/schedule.js`
- `my-shifts.html` (employee view) → `js/pages/my-shifts.js`
- `requests.html` (credential reset approvals) → `js/pages/requests.js`

**Supabase configuration (client)**
- `js/config.js` holds `SUPABASE_URL` + `SUPABASE_ANON_KEY` (anon key only; public).
- `js/supabaseClient.js` uses `@supabase/supabase-js@2.49.1` via CDN ESM.

## Auth contract used by frontend (must match backend)
The frontend logs users in via:
- `supabase.auth.signInWithPassword({ email, password })`
- `email` is computed as: `${companyCode}+${username}@yourapp.local` (must match `internalEmail()` in `supabase/functions/_shared/admin.ts`)
- `password` is a **4-digit PIN**.

After auth, the frontend loads the app profile from:
- `public.users` via: `.from('users').select('id, "companyCode", company_code, username, role, "employeeId", active').eq('id', auth.uid()).single()`

## Edge Functions used by the frontend
These are invoked from the browser (anon key + user JWT; RLS/role checks apply):
- `create_company_with_manager` (platform_admin only) — used on `dashboard.html`
- `terminate_company` (platform_admin only) — used on `dashboard.html`
- `create_employee_login` (manager only) — used by `requests.html` when approving username/both resets for employees
- `reset_user_pin` (manager or platform_admin) — used by `requests.html` when approving PIN resets

Notes:
- CORS currently allows `*` via `supabase/functions/_shared/cors.ts`, so GitHub Pages origin should work.

## Backend dependency / gotchas
1) **Password policy**: Auth must allow 4-character passwords (PINs). If hosted Supabase enforces 6+ by default, you must lower the minimum password length to 4 in Auth settings (or update the auth scheme).

2) **Bootstrap problem**: `create_company_with_manager` requires an existing `platform_admin` caller. The frontend no longer has an offline “master setup key” path, so you need a supported way to create the first platform admin, e.g.:
   - a one-time admin/seed process, or
   - a gated Edge Function (requires a secret bootstrap token) that creates the initial platform admin in `auth.users` + `public.users`.

3) **credential_reset_requests schema**: The new table does not include proposed new values (username/PIN). The UI prompts the approver for the new values at approval time, then:
   - calls the relevant Edge Function to apply the change, and
   - updates `credential_reset_requests.status` + `resolved_at`.

## Deployment checklist (hosted Supabase)
1) Link CLI to the hosted project:
- `supabase login`
- `supabase link --project-ref xwroayzhbbwbiuswtuvs`

2) Apply migrations (schema + RLS) to hosted DB:
- `supabase db push`

3) Deploy Edge Functions:
- `supabase functions deploy create_company_with_manager`
- `supabase functions deploy terminate_company`
- `supabase functions deploy create_employee_login`
- `supabase functions deploy reset_user_pin`
- `supabase functions deploy bootstrap_platform_admin`

4) Set Edge Function secrets (do not commit; set in Supabase):
- Note: keys starting with `SUPABASE_` are reserved and are already injected into hosted Edge Functions by Supabase.
- Set only the bootstrap secret:
  - `supabase secrets set BOOTSTRAP_TOKEN=<long_random_one_time_token>`

5) Confirm Auth settings:
- Minimum password length = 4 (PIN support).

## Bootstrap: create the first platform_admin (required)
The system requires a `platform_admin` user to call `create_company_with_manager`, but a fresh project has none.

Supported bootstrap path:
1) Pick a one-time token (long random string) and set it as `BOOTSTRAP_TOKEN` secret (step 4 above).
2) Call the Edge Function once to create the initial platform admin under tenant `PLATFORM`.

Example (curl):
```bash
curl -sS -X POST \
  "https://xwroayzhbbwbiuswtuvs.functions.supabase.co/bootstrap_platform_admin" \
  -H "content-type: application/json" \
  -H "apikey: <anon_key>" \
  -d '{
    "token": "<BOOTSTRAP_TOKEN>",
    "username": "admin",
    "pin": "1234"
  }'
```

Notes:
- This function returns `409` if a `platform_admin` already exists (one-time use guard).
- After successful bootstrap, rotate/remove `BOOTSTRAP_TOKEN` in Supabase secrets.
