# Agent 2 → Agent 1 Handoff (Frontend Cloud Validation)

This handoff covers what I changed on the frontend to make Cloud validation easier, plus how you (Agent 1) can run a safe, non-service-role validation against the Supabase Cloud project.

## What Changed

### 1) Login supports `email + PIN` (fallback)
The original login flow assumes the internal email scheme:
`<COMPANY_CODE>+<username>@yourapp.local` with a 4-digit PIN as password.

If your bootstrap platform admin account was created using a **real email** instead of the internal email scheme, the frontend previously had no way to sign in.

Change: on `login.html`, if **Company code is blank** and the **Username field contains `@`**, the app treats it as an email login and calls `signInWithPassword({ email, password: pin })`.

- `js/auth.js` adds `signInWithEmailPin()` + `normalizeEmail()`.
- `js/pages/login.js` selects email-login vs internal-email-login.
- `login.html` updates the subtitle to mention email login for platform admins.

How to use:
- Platform admin (real email): leave Company code empty, type email into Username, enter PIN.
- Everyone else (internal email): use Company code + username + PIN (unchanged).

### 2) Added a cloud validation script (anon key + user JWT only)
New file: `scripts/agent2_cloud_frontend_validation.sh`

Purpose:
- Validates auth + RLS behavior against **Supabase Cloud** using:
  - `SUPABASE_ANON_KEY` (public)
  - user JWTs obtained via password grant
- Never uses `SUPABASE_SERVICE_ROLE_KEY`.
- Never prints PINs or access tokens.

Notes:
- The script creates a new employee row in Company A and creates a shift for Employee 1 (so you get a persistence + RLS check). This writes test data to Cloud.

## Cloud Target Proof (Deployed Site)

The deployed GitHub Pages config is cloud-locked:
- `https://cybersolutionshq.github.io/Scheduler/js/config.js` sets:
  - `SUPABASE_PROJECT_REF = "xwroayzhbbwbiuswtuvs"`
  - `SUPABASE_URL = "https://xwroayzhbbwbiuswtuvs.supabase.co"`

## How To Run The Validation Script (Locally)

Pre-req:
- `jq` installed
- repo linked to the cloud project (already the intended one)

Run:
- `chmod +x scripts/agent2_cloud_frontend_validation.sh`
- `./scripts/agent2_cloud_frontend_validation.sh`

Inputs it will prompt for (don’t paste PINs into chat):
- Platform Admin:
  - either `PLATFORM_ADMIN_EMAIL` (real email login) OR `PLATFORM_ADMIN_USERNAME` (internal email)
  - `PLATFORM_ADMIN_PIN`
- Company A:
  - `COMPANY_A_CODE`
  - `MANAGER_A_USERNAME`
  - `MANAGER_A_PIN`
  - `EMPLOYEE_1_USERNAME`
  - `EMPLOYEE_1_PIN`
- Optional Company B cross-tenant check:
  - `COMPANY_B_CODE`, `MANAGER_B_USERNAME`, `MANAGER_B_PIN`

Outputs:
- Prints only PASS/FAIL lines and non-secret IDs (no PINs, no tokens).

## Manual UI Validation Checklist (What You Still Need To Do)

Because the container environment doesn’t provide a GUI browser, the required DevTools checks must be done by you locally:

1) Open `https://cybersolutionshq.github.io/Scheduler/`
2) DevTools → Network:
   - Confirm all Supabase API calls hit `https://xwroayzhbbwbiuswtuvs.supabase.co`
   - Functions hit `https://xwroayzhbbwbiuswtuvs.functions.supabase.co`
   - If you see `localhost` or `127.0.0.1`, stop and clear SW cache (Application → Service Workers → Unregister; Storage → Clear site data).
3) Run the required flow:
   - Platform Admin → Dashboard (role visible, admin nav visible)
   - Manager A → Employees CRUD (create employee, refresh persistence)
   - Manager A → Schedule create + Shift assign (refresh persistence)
   - Employee 1 → My Shifts (sees only own shifts; manager pages blocked)
   - Company B manager (if exists) → no data leakage from Company A

## Suggested Commit Message

`feat(auth): allow email+PIN login fallback; add cloud validation script`


# Agent 2 → Agent 1 Handover (Final – Recovery Only)

Status:
- Frontend confirmed deployed to Supabase cloud project:
  xwroayzhbbwbiuswtuvs.supabase.co
- Email + PIN login fallback implemented and committed
- Cloud validation script added (no secrets, anon + JWT only)

Blocker:
- Platform Admin PIN is unknown / inaccessible
- Normal login cannot proceed until owner regains admin access

Owner Decision:
- Implement **Option A: One-Time Platform Admin Reset Token**
- This is an intentional, owner-approved “break glass” recovery
- Token must be:
  - single-use
  - time-limited
  - auditable
  - removable later

Scope:
- Backend only (Supabase SQL + RPC)
- No secrets printed
- No permanent auth bypass
- Frontend changes limited to recovery input + forced PIN change

Next Owner Action:
- Use reset token once
- Change Platform Admin PIN immediately
- Resume normal validation + RLS testing

This handover supersedes all prior validation blockers.


