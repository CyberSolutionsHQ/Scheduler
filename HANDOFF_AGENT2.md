# Agent 2 Handoff (Frontend) — Schedule Manager + Supabase

This repo contains a Supabase backend (migrations + Edge Functions) and a static frontend (GitHub Pages). The backend is **multi-tenant** via `company_code` / `companyCode` and **RLS is enforced**.

---

## 1) Final Schema Summary (public schema)

Notes:
- Many tables use **quoted camelCase columns** (e.g. `"companyCode"`, `"createdAt"`). In `supabase-js`, you reference them as `companyCode`, `createdAt`, etc.
- For frontend convenience, several tables also have **generated snake_case aliases** (e.g. `company_code`, `created_at`) that are computed from the camelCase columns. Generated columns are **read-only**.

### companies
**Table:** `public.companies`
- Columns
  - `id uuid` PK default `gen_random_uuid()`
  - `"companyCode" text` NOT NULL, `UPPERCASE` check, UNIQUE
  - `"companyName" text` NOT NULL
  - `"isDisabled" boolean` NOT NULL default `false`
  - `"supportEnabled" boolean` NOT NULL default `false`
  - `"createdAt" timestamptz` NOT NULL default `now()`
  - `company_code text` GENERATED ALWAYS AS (`"companyCode"`) STORED
  - `name text` GENERATED ALWAYS AS (`"companyName"`) STORED
  - `created_at timestamptz` GENERATED ALWAYS AS (`"createdAt"`) STORED
- Indexes
  - `companies_company_code_idx` on `"companyCode"`
  - `companies_company_code_uq_v2` UNIQUE on `company_code`

### users (app profile mapped to auth.users)
**Table:** `public.users`
- Columns
  - `id uuid` PK, **FK → `auth.users(id)`** `ON DELETE CASCADE`
  - `"companyCode" text` NOT NULL (UPPERCASE check); `"PLATFORM"` is reserved for platform context
  - `username text` NOT NULL (lowercase check); UNIQUE per company via (`"companyCode"`, `username`)
  - `"pinHash" text` NOT NULL
  - `role public.user_role` NOT NULL (`platform_admin` | `manager` | `employee`)
  - `"employeeId" uuid` NULL (required when `role='employee'`)
  - `active boolean` NOT NULL default `true`
  - `"createdAt" timestamptz` NOT NULL default `now()`
  - `"updatedAt" timestamptz` NOT NULL default `now()`
  - `company_code text` GENERATED ALWAYS AS (`"companyCode"`) STORED
  - `pin_hash text` GENERATED ALWAYS AS (`"pinHash"`) STORED
  - `created_at timestamptz` GENERATED ALWAYS AS (`"createdAt"`) STORED
  - `updated_at timestamptz` GENERATED ALWAYS AS (`"updatedAt"`) STORED
- Keys / constraints
  - `"employeeId"` FK → `public.employees("companyCode", id)` (deferrable)
  - Check: `(role <> 'employee' and "employeeId" is null) or (role = 'employee' and "employeeId" is not null)`
- Indexes
  - `users_company_code_idx` on `"companyCode"`
  - `users_company_code_role_idx` on (`"companyCode"`, `role`)
  - `users_company_code_employee_id_idx` on (`"companyCode"`, `"employeeId"`)
  - `users_company_code_id_uq_v2` UNIQUE on (`company_code`, `id`) (supports composite FKs)

### employees
**Table:** `public.employees`
- Columns
  - `id uuid` PK default `gen_random_uuid()`
  - `"companyCode" text` NOT NULL (UPPERCASE check)
  - `name text` NOT NULL
  - `contact text` NOT NULL default `''`
  - `active boolean` NOT NULL default `true`
  - `"createdAt" timestamptz` NOT NULL default `now()`
  - `"updatedAt" timestamptz` NOT NULL default `now()`
  - `company_code text` GENERATED ALWAYS AS (`"companyCode"`) STORED
  - `created_at timestamptz` GENERATED ALWAYS AS (`"createdAt"`) STORED
  - `updated_at timestamptz` GENERATED ALWAYS AS (`"updatedAt"`) STORED
- Indexes
  - `employees_company_code_idx` on `"companyCode"`
  - `employees_company_code_active_idx` on (`"companyCode"`, `active`)
  - `employees_company_code_id_uq_v2` UNIQUE on (`company_code`, `id`)

### job_sites (renamed from legacy `locations`)
**Table:** `public.job_sites`
- Columns
  - `id uuid` PK default `gen_random_uuid()`
  - `"companyCode" text` NOT NULL (UPPERCASE check)
  - `name text` NOT NULL
  - `address text` NOT NULL default `''`
  - `active boolean` NOT NULL default `true`
  - `"createdAt" timestamptz` NOT NULL default `now()`
  - `"updatedAt" timestamptz` NOT NULL default `now()`
  - `company_code text` GENERATED ALWAYS AS (`"companyCode"`) STORED
  - `created_at timestamptz` GENERATED ALWAYS AS (`"createdAt"`) STORED
  - `updated_at timestamptz` GENERATED ALWAYS AS (`"updatedAt"`) STORED
- Indexes
  - `locations_company_code_idx` on `"companyCode"` (index name kept from original table)
  - `job_sites_company_code_id_uq_v2` UNIQUE on (`company_code`, `id`)

### schedules
**Table:** `public.schedules`
- Columns
  - `id uuid` PK default `gen_random_uuid()`
  - `company_code text` NOT NULL (UPPERCASE check), **FK → `public.companies(company_code)`**
  - `week_start_date date` NOT NULL
  - `created_at timestamptz` NOT NULL default `now()`
- Constraints / indexes
  - UNIQUE (`company_code`, `week_start_date`) (`schedules_company_week_unique`)
  - UNIQUE (`company_code`, `id`) (`schedules_company_code_id_unique`)
  - Indexes: `schedules_company_code_idx`, `schedules_company_code_week_start_date_idx`

### shifts
**Table:** `public.shifts`
- Columns (canonical)
  - `id uuid` PK default `gen_random_uuid()`
  - `"companyCode" text` NOT NULL (UPPERCASE check)
  - `date date` NOT NULL
  - `start time` NOT NULL
  - `"end" time` NOT NULL
  - `notes text` NOT NULL default `''`
  - `"locId" uuid` NOT NULL (FK → `public.job_sites("companyCode", id)`)
  - `"empId" uuid` NULL (FK → `public.employees("companyCode", id)`)
  - `"crewId" uuid` NULL (FK → `public.crews("companyCode", id)`)
  - `"createdAt" timestamptz` NOT NULL default `now()`
  - `"updatedAt" timestamptz` NOT NULL default `now()`
- Additional columns (added by backend foundation)
  - `company_code text` GENERATED ALWAYS AS (`"companyCode"`) STORED
  - `schedule_id uuid` (FK → `public.schedules(company_code, id)` via `shifts_schedule_fk_v2`)
  - `employee_id uuid` GENERATED ALWAYS AS (`"empId"`) STORED
  - `job_site_id uuid` GENERATED ALWAYS AS (`"locId"`) STORED
  - `start_time timestamp` GENERATED ALWAYS AS (`date + start`) STORED
  - `end_time timestamp` GENERATED ALWAYS AS (`date + "end"`) STORED
  - `created_at timestamptz` GENERATED ALWAYS AS (`"createdAt"`) STORED
  - `updated_at timestamptz` GENERATED ALWAYS AS (`"updatedAt"`) STORED
- Constraints / indexes
  - XOR target: (`"empId" is null) <> ("crewId" is null)` (`shifts_xor_target`)
  - Indexes: `shifts_company_code_idx`, `shifts_company_code_date_idx`, `shifts_company_code_emp_date_idx`, `shifts_company_code_crew_date_idx`
  - Index: `shifts_company_code_schedule_id_idx` on (`company_code`, `schedule_id`)

### credential_reset_requests (new)
**Table:** `public.credential_reset_requests`
- Columns
  - `id uuid` PK default `gen_random_uuid()`
  - `company_code text` NOT NULL (UPPERCASE check)
  - `requested_by_user_id uuid` NOT NULL
  - `target_user_id uuid` NOT NULL
  - `request_type public.credential_reset_request_type` NOT NULL (`username` | `pin` | `both`)
  - `status public.credential_reset_request_status` NOT NULL default `'pending'` (`pending` | `approved` | `denied`)
  - `created_at timestamptz` NOT NULL default `now()`
  - `resolved_at timestamptz` NULL
- Foreign keys
  - (`company_code`, `requested_by_user_id`) → `public.users(company_code, id)` `ON DELETE CASCADE`
  - (`company_code`, `target_user_id`) → `public.users(company_code, id)` `ON DELETE CASCADE`
- Indexes
  - `credential_reset_requests_company_code_idx` on `company_code`
  - `credential_reset_requests_company_code_status_idx` on (`company_code`, `status`)
  - `credential_reset_requests_target_user_id_idx` on (`target_user_id`)

### Other existing tables (still in schema)
These exist and have their own constraints/indexes/RLS from earlier migrations:
- `job_types`, `crews`, `crew_members`, `shift_jobs`, `requests`

---

## 2) Auth Model

- Authentication is handled by Supabase Auth (`auth.users`).
- Application user profile is `public.users`:
  - `public.users.id = auth.users.id` (enforced by FK `users_auth_users_fk`)
  - `public.users.companyCode` / generated `public.users.company_code` stores the tenant key
  - `public.users.role` stores one of: `platform_admin`, `manager`, `employee`
  - `public.users.employeeId` links an employee login to `public.employees.id` for `role='employee'`

**Company isolation key lives in:** `public.users.company_code` (generated from `"companyCode"`).

---

## 3) RLS Overview (what’s enabled + intent)

RLS is **enabled + forced** on:
- `companies`, `users`, `employees`, `job_sites`, `schedules`, `shifts`, `credential_reset_requests`

Helper functions resolve tenant + role from `auth.uid()`:
- `public.current_company_code()` → text (tenant key for current auth user)
- `public.current_user_role()` → `public.user_role`
- `public.is_platform_admin()` / `public.is_manager()` → boolean
- `public.current_employee_id()` → uuid

Policy intent (high-level):
- `companies`
  - `service_role`: full access
  - `platform_admin`: full access (manage companies)
  - `manager/employee`: select only their own company row
- `users` (profile)
  - `service_role`: full access (Edge Functions/admin only)
  - `platform_admin`: select all users
  - `manager`: select users in same company
  - `employee`: select self only
  - Client-side insert/update/delete is intentionally not granted
- `employees`
  - `platform_admin`: full access
  - `manager`: CRUD within their company
  - `employee`: select self only
- `job_sites`
  - `platform_admin`: full access
  - `manager`: CRUD within their company
  - `employee`: select within their company
- `schedules`
  - `platform_admin`: full access
  - `manager`: CRUD within their company
  - `employee`: select within their company
- `shifts`
  - `platform_admin`: full access
  - `manager`: CRUD within their company
  - `employee`: select only shifts where `employee_id = current_employee_id()`
- `credential_reset_requests`
  - `platform_admin`: full access
  - `manager`: select/insert/update within their company
  - `employee`: select where requester/target is self; insert self-request (status must be `pending`)

---

## 4) SQL Functions / RPC Endpoints

These SQL functions exist primarily to support RLS. You *can* call them via `supabase.rpc(...)` if needed.

- `current_company_code()` → `text`
  - Purpose: resolve current user tenant via `auth.uid()`
  - Example:
    ```js
    const { data, error } = await supabase.rpc('current_company_code')
    ```
- `current_user_role()` → `user_role`
  - Purpose: resolve current user role via `auth.uid()`
  - Example:
    ```js
    const { data } = await supabase.rpc('current_user_role')
    ```
- `is_platform_admin()` → `boolean`
- `is_manager()` → `boolean`
- `current_employee_id()` → `uuid`

Also present from earlier migrations:
- `set_updated_at()` trigger helper
- `prevent_company_code_update()` trigger helper (guards against changing tenant key)

---

## 5) Frontend Environment Variables

Required for the static frontend:
- `SUPABASE_URL` (e.g. local: `http://127.0.0.1:54321`)
- `SUPABASE_ANON_KEY` (public anon key)

Never use client-side:
- `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS)
- Any JWT secret / database password / internal keys

How to get local values (copy/paste):
- `unset DOCKER_HOST CONTAINER_HOST; supabase status -o env`

---

## 6) Example supabase-js Queries (copy/paste friendly)

Assumes:
```js
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
```

### Employees (manager CRUD; employee reads self)
List:
```js
const { data, error } = await supabase
  .from('employees')
  .select('id, companyCode, name, contact, active, createdAt, updatedAt')
  .order('name')
```

Create (note: insert **`companyCode`**, not `company_code`):
```js
const { data, error } = await supabase
  .from('employees')
  .insert([{ companyCode: 'ACME', name: 'Jane Doe', contact: '555-1234', active: true }])
  .select()
  .single()
```

Update:
```js
const { data, error } = await supabase
  .from('employees')
  .update({ active: false })
  .eq('id', employeeId)
  .select()
  .single()
```

Delete:
```js
const { error } = await supabase.from('employees').delete().eq('id', employeeId)
```

### Job Sites (table name is `job_sites`)
List:
```js
const { data, error } = await supabase
  .from('job_sites')
  .select('id, companyCode, name, address, active')
  .order('name')
```

Create:
```js
const { data, error } = await supabase
  .from('job_sites')
  .insert([{ companyCode: 'ACME', name: 'Main Site', address: '123 Road', active: true }])
  .select()
  .single()
```

### Schedules
Create (this table uses snake_case):
```js
const { data, error } = await supabase
  .from('schedules')
  .insert([{ company_code: 'ACME', week_start_date: '2025-12-15' }])
  .select()
  .single()
```

Fetch a week:
```js
const { data, error } = await supabase
  .from('schedules')
  .select('id, company_code, week_start_date, created_at')
  .eq('week_start_date', '2025-12-15')
  .maybeSingle()
```

### Shifts
List shifts for a schedule (with joins):
```js
const { data, error } = await supabase
  .from('shifts')
  .select(`
    id, companyCode, date, start, end, notes, schedule_id,
    job_site:job_sites!shifts_company_code_loc_fk(id, name, address),
    employee:employees!shifts_company_code_emp_fk(id, name),
    schedule:schedules!shifts_schedule_fk_v2(id, week_start_date)
  `)
  .eq('schedule_id', scheduleId)
  .order('date')
  .order('start')
```

Create shift (manager; either `empId` OR `crewId` must be set; include `schedule_id`):
```js
const { data, error } = await supabase
  .from('shifts')
  .insert([{
    companyCode: 'ACME',
    schedule_id: scheduleId,
    date: '2025-12-16',
    start: '08:00:00',
    end: '16:00:00',
    notes: '',
    locId: jobSiteId,
    empId: employeeId,     // OR crewId (but not both)
    crewId: null
  }])
  .select()
  .single()
```

Update shift:
```js
const { data, error } = await supabase
  .from('shifts')
  .update({ notes: 'Bring PPE' })
  .eq('id', shiftId)
  .select()
  .single()
```

Delete shift:
```js
const { error } = await supabase.from('shifts').delete().eq('id', shiftId)
```

### Credential Reset Requests
Employee creates a self-request:
```js
const { data: authData } = await supabase.auth.getUser()
const myUserId = authData?.user?.id

const { data, error } = await supabase
  .from('credential_reset_requests')
  .insert([{
    company_code: 'ACME',
    requested_by_user_id: myUserId,
    target_user_id: myUserId,
    request_type: 'pin',
    status: 'pending'
  }])
  .select()
  .single()
```

Manager lists pending:
```js
const { data, error } = await supabase
  .from('credential_reset_requests')
  .select('*')
  .eq('status', 'pending')
  .order('created_at', { ascending: false })
```

Manager resolves:
```js
const { data, error } = await supabase
  .from('credential_reset_requests')
  .update({ status: 'approved', resolved_at: new Date().toISOString() })
  .eq('id', requestId)
  .select()
  .single()
```

---

## 7) Local Dev Checklist (exact commands)

If you see Docker/Podman connection issues, run:
- `unset DOCKER_HOST CONTAINER_HOST`

Start local Supabase:
- `supabase start`

Apply migrations to local DB:
- `supabase db push --local`

Validate schema:
- `supabase db lint --local`

Get local keys/URLs:
- `supabase status -o env`

Useful local URLs (per `supabase/config.toml`):
- API: `http://127.0.0.1:54321`
- Studio: `http://127.0.0.1:54323`

---

## 8) Hosted Bootstrap (first-time setup)

Hosted Supabase needs an initial `platform_admin` account to use the UI flow that creates companies.
Backend provides a one-time bootstrap Edge Function:
- Function: `bootstrap_platform_admin`
- Guard: requires secret `BOOTSTRAP_TOKEN` and refuses if a platform admin already exists.

Example call (curl):
```bash
curl -sS -X POST \
  "https://<project-ref>.functions.supabase.co/bootstrap_platform_admin" \
  -H "content-type: application/json" \
  -H "apikey: <anon_key>" \
  -d '{"token":"<BOOTSTRAP_TOKEN>","username":"admin","pin":"1234"}'
```
