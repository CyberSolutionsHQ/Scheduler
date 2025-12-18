# Supabase Handoff Contract (Frontend ⇄ Backend)

Project: **Cyber Solutions LLC Schedule Manager** (local-first today, Supabase later)  
Audience: Agent 1 (Supabase Backend Architect) + future frontend cloud adapter work

## 1) Canonical Entities (tables + fields)

All rows are tenant-isolated by `companyCode` (UPPERCASE). All `id` values are stable strings (UUIDs for new rows; older data may contain legacy string IDs).

### `companies`
- `id` (string)
- `companyCode` (string, UPPERCASE, unique)
- `companyName` (string)
- `isDisabled` (boolean)
- `supportEnabled` (boolean, stub only)
- `createdAt` (ISO string)

### `users`
- `id` (string)
- `companyCode` (string, UPPERCASE) — `"PLATFORM"` allowed for platform admin
- `username` (string, lowercased)
- `pinHash` (string) — local format is SHA-256 of `${companyCode}:${username}:${pin}` (fallback `plain:<pin>` when crypto is unavailable)
- `role` (string enum: `platform_admin` | `manager` | `employee`)
- `employeeId` (string|null) — required when `role === "employee"`
- `active` (boolean)
- `createdAt` (ISO string)
- `updatedAt` (ISO string)

### `employees`
- `id` (string)
- `companyCode` (string, UPPERCASE)
- `name` (string)
- `contact` (string)
- `active` (boolean)
- `createdAt` (ISO string)
- `updatedAt` (ISO string)

### `locations`
- `id` (string)
- `companyCode` (string, UPPERCASE)
- `name` (string)
- `address` (string)
- `active` (boolean)
- `createdAt` (ISO string)
- `updatedAt` (ISO string)

### `job_types`
- `id` (string)
- `companyCode` (string, UPPERCASE)
- `name` (string)
- `active` (boolean)
- `createdAt` (ISO string)
- `updatedAt` (ISO string)

### `crews`
- `id` (string)
- `companyCode` (string, UPPERCASE)
- `name` (string)
- `active` (boolean)
- `createdAt` (ISO string)
- `updatedAt` (ISO string)

### `crew_members`
- `id` (string)
- `companyCode` (string, UPPERCASE)
- `crewId` (string FK → `crews.id`)
- `employeeId` (string FK → `employees.id`)
- `createdAt` (ISO string)

### `shifts`
- `id` (string)
- `companyCode` (string, UPPERCASE)
- `date` (string, `YYYY-MM-DD`)
- `start` (string, `HH:MM`)
- `end` (string, `HH:MM`)
- `notes` (string)
- `locId` (string FK → `locations.id`)
- `empId` (string|null FK → `employees.id`)
- `crewId` (string|null FK → `crews.id`)
- `createdAt` (ISO string)
- `updatedAt` (ISO string)

### `shift_jobs`
- `id` (string)
- `companyCode` (string, UPPERCASE)
- `shiftId` (string FK → `shifts.id`)
- `jobTypeId` (string FK → `job_types.id`)
- `createdAt` (ISO string)

### `requests`
Credential-change workflow entries (local-first now; later via Edge Functions).
- `id` (string)
- `companyCode` (string, UPPERCASE) — `"PLATFORM"` used for platform-admin self-audit requests
- `type` (string enum: `manager_change_credentials` | `employee_change_credentials` | `admin_change_credentials`)
- `status` (string enum: `pending` | `approved` | `denied`)
- `requesterUserId` (string FK → `users.id`)
- `targetUserId` (string FK → `users.id`)
- `proposedUsername` (string, lowercased, may be empty)
- `proposedPin` (string, 4 digits, may be empty)
- `createdAt` (ISO string)
- `handledAt` (ISO string, optional/empty when pending)
- `handledBy` (string, optional/empty when pending)
- `decisionNote` (string, optional) — currently also holds requester notes (prefixed `Request:`) and handler notes (prefixed `Decision:`)

## 2) Tenant Key: `companyCode`

- Canonical form: `UPPERCASE` (normalized on write and on migration).
- Uniqueness: one `companyCode` per company (`companies.companyCode` unique).
- Tenant isolation rule: every row in tenant tables includes `companyCode`, and all reads/writes must filter/enforce by it.
- Reserved: `"PLATFORM"` is used for the `platform_admin` account context.

## 3) Roles + Permissions Matrix

| Role | Scope | Allowed actions |
|---|---|---|
| `platform_admin` | platform-wide | Manage `companies`; approve/deny manager credential requests; create/reset manager credentials; does **not** browse tenant schedule data by default. |
| `manager` | within `companyCode` | Full CRUD on tenant data: employees, locations, job_types, crews, crew_members, shifts, shift_jobs; manage employee logins within company; approve/deny employee credential requests. |
| `employee` | within `companyCode` | Read-only schedule access: their own employee shifts plus crew shifts for crews they belong to; can request credential changes. |

## 4) Shift Targeting Rule (required)

`shifts.empId XOR shifts.crewId` must be true (exactly one is set, never both, never neither).

## 5) Required PDF Queries (backend must support)

### Employee schedule (for employee `E`, period)
Inputs: `companyCode`, `employeeId`, and either `mode="daily"+date` or `mode="weekly"+weekStart` (or similar).
- Fetch `employees` row for `E` (verify `companyCode`).
- Fetch crew membership: `crew_members` where `employeeId = E` → set of `crewId`s.
- Fetch shifts in period where:
  - `empId = E`, OR
  - `crewId IN (crewIds)`
- Join for print:
  - `locations` via `shifts.locId`
  - `shift_jobs` via `shift_jobs.shiftId`
  - `job_types` via `shift_jobs.jobTypeId`
  - `crews` via `shifts.crewId` (for labeling crew shifts)

### All crews schedule (daily/weekly)
Inputs: `companyCode`, plus either `date` (daily) or `weekStart` (weekly).
- Fetch crews in tenant.
- For each crew:
  - Members: `crew_members` join `employees` for names (include inactive if desired by UI).
  - Shifts in period: `shifts` where `crewId = crew.id` and date in range.
  - Join `locations`, `shift_jobs`, `job_types` as above.

## 6) Supabase Edge Functions Needed (names + I/O)

These are the expected function contracts to mirror current local workflows (no Supabase implementation in frontend yet).

### `create_company_with_manager(companyName, companyCode, managerUsername, managerPin) -> { companyCode, managerUsername, managerPin, companyId? }`
- Creates `companies` row and a `users` row (`role="manager"`) in that tenant.
- Must enforce `companyCode` uniqueness and normalization to uppercase.
- Must hash PIN server-side and return the plaintext PIN only in the function response (same behavior as local onboarding flow).

### `create_employee_login(companyCode, employeeId, username, pin) -> { username, pin }`
- Creates or updates an employee `users` row linked to `employeeId` with `role="employee"`.
- Enforces `username` uniqueness within tenant.

### `reset_user_pin(companyCode, username, newPin) -> { ok }`
- Resets PIN (and/or re-activates user) for the given tenant + username.

### Optional: `terminate_company(companyCode) -> { ok }`
- Sets `companies.isDisabled = true` (and optionally blocks all tenant sign-ins).
- No data deletion required.

## 7) Future Support Mode (stub only)

`companies.supportEnabled` (and/or `APP_CONFIG.SUPPORT_MODE`) is reserved for a future “support access” feature. No UI/behavior is implemented yet; backend should treat it as a feature flag placeholder only.

