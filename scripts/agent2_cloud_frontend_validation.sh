#!/usr/bin/env bash
set -euo pipefail

# Agent 2 - Cloud frontend validation (API-level, anon key + user JWT only)
# - Targets Supabase Cloud project xwroayzhbbwbiuswtuvs (never localhost)
# - Uses real test accounts (provide via env or prompts)
# - Does NOT print PINs or access tokens
#
# Required env (or will try to read from js/config.js):
#   SUPABASE_ANON_KEY
#
# Required credentials (env or prompt):
#   PLATFORM_ADMIN_EMAIL or (PLATFORM_ADMIN_COMPANY_CODE + PLATFORM_ADMIN_USERNAME)
#   PLATFORM_ADMIN_PIN
#   COMPANY_A_CODE, MANAGER_A_USERNAME, MANAGER_A_PIN
#   EMPLOYEE_1_USERNAME, EMPLOYEE_1_PIN
#
# Optional (for Test 5):
#   COMPANY_B_CODE, MANAGER_B_USERNAME, MANAGER_B_PIN
#
# Usage:
#   ./scripts/agent2_cloud_frontend_validation.sh

EXPECTED_PROJECT_REF="xwroayzhbbwbiuswtuvs"
BASE_URL="https://${EXPECTED_PROJECT_REF}.supabase.co"
FUNCTIONS_URL="https://${EXPECTED_PROJECT_REF}.functions.supabase.co"

if ! command -v jq >/dev/null 2>&1; then
  echo "Missing dependency: jq" >&2
  exit 1
fi

internal_email() {
  local company_code="$1"
  local username="$2"
  printf "%s+%s@yourapp.local" "$company_code" "$username"
}

require_value() {
  local name="$1"
  local prompt="$2"
  local secret="${3:-0}"

  if [[ -n "${!name:-}" ]]; then
    return 0
  fi

  if [[ ! -t 0 ]]; then
    echo "Missing ${name} and no TTY available. Export ${name} and re-run." >&2
    exit 1
  fi

  if [[ "$secret" == "1" ]]; then
    read -s -p "${prompt}: " "$name"
    echo
  else
    read -r -p "${prompt}: " "$name"
  fi
}

maybe_read_anon_key_from_frontend() {
  if [[ -n "${SUPABASE_ANON_KEY:-}" ]]; then
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    SUPABASE_ANON_KEY="$(
      node -e "const fs=require('fs');const s=fs.readFileSync('./js/config.js','utf8');const m=s.match(/SUPABASE_ANON_KEY\\s*=\\s*\\n?\\s*\\\"([^\\\"]+)\\\"/);if(!m) process.exit(1);process.stdout.write(m[1]);" \
        2>/dev/null || true
    )"
  fi
  if [[ -z "${SUPABASE_ANON_KEY:-}" ]]; then
    echo "Missing SUPABASE_ANON_KEY (and could not read from js/config.js)." >&2
    exit 1
  fi
}

auth_password_grant() {
  local email="$1"
  local password="$2"
  curl -sS -X POST \
    "${BASE_URL}/auth/v1/token?grant_type=password" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "content-type: application/json" \
    --data-binary "$(
      jq -cn --arg email "$email" --arg password "$password" '{email:$email,password:$password}'
    )"
}

rest_select() {
  local bearer="$1"
  local path_and_query="$2"
  curl -sS \
    "${BASE_URL}/rest/v1/${path_and_query}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "authorization: Bearer ${bearer}"
}

rest_insert() {
  local bearer="$1"
  local table="$2"
  local json_body="$3"
  curl -sS -X POST \
    "${BASE_URL}/rest/v1/${table}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "authorization: Bearer ${bearer}" \
    -H "content-type: application/json" \
    -H "prefer: return=representation" \
    --data-binary "$json_body"
}

rest_update() {
  local bearer="$1"
  local table_and_query="$2"
  local json_body="$3"
  curl -sS -X PATCH \
    "${BASE_URL}/rest/v1/${table_and_query}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "authorization: Bearer ${bearer}" \
    -H "content-type: application/json" \
    -H "prefer: return=representation" \
    --data-binary "$json_body"
}

call_function() {
  local function_name="$1"
  local bearer="$2"
  local json_body="$3"
  curl -sS -X POST \
    "${FUNCTIONS_URL}/${function_name}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "authorization: Bearer ${bearer}" \
    -H "content-type: application/json" \
    --data-binary "$json_body"
}

extract_token_or_fail() {
  local raw="$1"
  local token
  token="$(echo "$raw" | jq -r '.access_token // empty')"
  if [[ -z "$token" ]]; then
    local msg
    msg="$(echo "$raw" | jq -r '.error_description // .msg // .message // .error // empty')"
    echo "Auth failed: ${msg:-unknown error}" >&2
    exit 1
  fi
  echo "$token"
}

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*"; return 1; }

maybe_read_anon_key_from_frontend

echo "Target:"
echo "  Supabase:  ${BASE_URL}"
echo "  Functions: ${FUNCTIONS_URL}"

echo
echo "TEST 1 — Platform Admin auth + profile"
PLATFORM_ADMIN_COMPANY_CODE="${PLATFORM_ADMIN_COMPANY_CODE:-PLATFORM}"
PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-}"
PLATFORM_ADMIN_USERNAME="${PLATFORM_ADMIN_USERNAME:-}"
PLATFORM_ADMIN_PIN="${PLATFORM_ADMIN_PIN:-}"
require_value "PLATFORM_ADMIN_PIN" "PLATFORM_ADMIN_PIN (4 digits)" 1

if [[ -n "$PLATFORM_ADMIN_EMAIL" ]]; then
  pa_email="$PLATFORM_ADMIN_EMAIL"
else
  require_value "PLATFORM_ADMIN_USERNAME" "PLATFORM_ADMIN_USERNAME" 0
  pa_email="$(internal_email "${PLATFORM_ADMIN_COMPANY_CODE}" "$(echo "$PLATFORM_ADMIN_USERNAME" | tr '[:upper:]' '[:lower:]')")"
fi

pa_auth="$(auth_password_grant "$pa_email" "$PLATFORM_ADMIN_PIN")"
PA_TOKEN="$(extract_token_or_fail "$pa_auth")"
PA_USER_ID="$(echo "$pa_auth" | jq -r '.user.id // empty')"

pa_profile="$(rest_select "$PA_TOKEN" "users?select=id,role,company_code,companyCode,username,active&id=eq.${PA_USER_ID}")"
pa_role="$(echo "$pa_profile" | jq -r '.[0].role // empty')"
if [[ "$pa_role" == "platform_admin" ]]; then
  pass "platform_admin session OK (role=${pa_role})"
else
  echo "$pa_profile" | jq '.' >&2
  fail "expected role=platform_admin"
fi

echo
echo "TEST 2 — Manager A Employees CRUD"
COMPANY_A_CODE="${COMPANY_A_CODE:-}"
MANAGER_A_USERNAME="${MANAGER_A_USERNAME:-}"
MANAGER_A_PIN="${MANAGER_A_PIN:-}"
require_value "COMPANY_A_CODE" "COMPANY_A_CODE (Company A)" 0
require_value "MANAGER_A_USERNAME" "MANAGER_A_USERNAME (Company A manager)" 0
require_value "MANAGER_A_PIN" "MANAGER_A_PIN (4 digits)" 1

ma_email="$(internal_email "$(echo "$COMPANY_A_CODE" | tr '[:lower:]' '[:upper:]')" "$(echo "$MANAGER_A_USERNAME" | tr '[:upper:]' '[:lower:]')")"
ma_auth="$(auth_password_grant "$ma_email" "$MANAGER_A_PIN")"
MA_TOKEN="$(extract_token_or_fail "$ma_auth")"
MA_USER_ID="$(echo "$ma_auth" | jq -r '.user.id // empty')"

ma_profile="$(rest_select "$MA_TOKEN" "users?select=id,role,companyCode,company_code,username,active&id=eq.${MA_USER_ID}")"
ma_role="$(echo "$ma_profile" | jq -r '.[0].role // empty')"
if [[ "$ma_role" != "manager" ]]; then
  echo "$ma_profile" | jq '.' >&2
  fail "expected role=manager"
fi

employees_before="$(rest_select "$MA_TOKEN" "employees?select=id,name,companyCode&order=name.asc")"
before_count="$(echo "$employees_before" | jq 'length')"

ts="$(date -u +%Y%m%d%H%M%S)"
new_employee_name="Agent2 Employee ${ts}"
new_employee_contact="agent2-${ts}@example.invalid"
new_employee="$(
  rest_insert "$MA_TOKEN" "employees" "$(
    jq -cn \
      --arg companyCode "$(echo "$COMPANY_A_CODE" | tr '[:lower:]' '[:upper:]')" \
      --arg name "$new_employee_name" \
      --arg contact "$new_employee_contact" \
      '{companyCode:$companyCode,name:$name,contact:$contact,active:true}'
  )"
)"
NEW_EMPLOYEE_ID="$(echo "$new_employee" | jq -r '.[0].id // empty')"
if [[ -z "$NEW_EMPLOYEE_ID" ]]; then
  echo "$new_employee" | jq '.' >&2
  fail "failed to create employee"
fi

employees_after="$(rest_select "$MA_TOKEN" "employees?select=id,name&order=name.asc")"
after_count="$(echo "$employees_after" | jq 'length')"
if [[ "$after_count" -lt $((before_count + 1)) ]]; then
  fail "employee count did not increase"
fi
if [[ "$(echo "$employees_after" | jq -r --arg id "$NEW_EMPLOYEE_ID" '.[] | select(.id==$id) | .name' | head -n 1)" != "$new_employee_name" ]]; then
  fail "new employee not found after refresh"
fi
pass "employees list + create persisted"

echo
echo "TEST 3 — Manager A Schedule + Shift assignment"
EMPLOYEE_1_USERNAME="${EMPLOYEE_1_USERNAME:-}"
EMPLOYEE_1_PIN="${EMPLOYEE_1_PIN:-}"
require_value "EMPLOYEE_1_USERNAME" "EMPLOYEE_1_USERNAME (Company A employee)" 0
require_value "EMPLOYEE_1_PIN" "EMPLOYEE_1_PIN (4 digits)" 1

e1_user_row="$(rest_select "$MA_TOKEN" "users?select=id,username,role,employeeId,companyCode&username=eq.$(echo "$EMPLOYEE_1_USERNAME" | tr '[:upper:]' '[:lower:]')")"
E1_EMPLOYEE_ID="$(echo "$e1_user_row" | jq -r '.[0].employeeId // empty')"
if [[ -z "$E1_EMPLOYEE_ID" ]]; then
  echo "$e1_user_row" | jq '.' >&2
  fail "could not resolve Employee 1 employeeId via users table (RLS?)"
fi

job_sites="$(rest_select "$MA_TOKEN" "job_sites?select=id,name,active&order=name.asc")"
JOB_SITE_ID="$(echo "$job_sites" | jq -r '.[0].id // empty')"
if [[ -z "$JOB_SITE_ID" ]]; then
  created_site="$(
    rest_insert "$MA_TOKEN" "job_sites" "$(
      jq -cn \
        --arg companyCode "$(echo "$COMPANY_A_CODE" | tr '[:lower:]' '[:upper:]')" \
        --arg name "Agent2 Site ${ts}" \
        --arg address "Agent2 Address" \
        '{companyCode:$companyCode,name:$name,address:$address,active:true}'
    )"
  )"
  JOB_SITE_ID="$(echo "$created_site" | jq -r '.[0].id // empty')"
  if [[ -z "$JOB_SITE_ID" ]]; then
    echo "$created_site" | jq '.' >&2
    fail "failed to create job site"
  fi
fi

WEEK_START_DATE="$(date -u -d 'monday this week' +%F)"
sched_row="$(rest_select "$MA_TOKEN" "schedules?select=id,company_code,week_start_date&company_code=eq.$(echo "$COMPANY_A_CODE" | tr '[:lower:]' '[:upper:]')&week_start_date=eq.${WEEK_START_DATE}")"
SCHEDULE_ID="$(echo "$sched_row" | jq -r '.[0].id // empty')"
if [[ -z "$SCHEDULE_ID" ]]; then
  created_sched="$(
    rest_insert "$MA_TOKEN" "schedules" "$(
      jq -cn \
        --arg company_code "$(echo "$COMPANY_A_CODE" | tr '[:lower:]' '[:upper:]')" \
        --arg week_start_date "$WEEK_START_DATE" \
        '{company_code:$company_code,week_start_date:$week_start_date}'
    )"
  )"
  SCHEDULE_ID="$(echo "$created_sched" | jq -r '.[0].id // empty')"
  if [[ -z "$SCHEDULE_ID" ]]; then
    echo "$created_sched" | jq '.' >&2
    fail "failed to create schedule"
  fi
fi

shift_created="$(
  rest_insert "$MA_TOKEN" "shifts" "$(
    jq -cn \
      --arg companyCode "$(echo "$COMPANY_A_CODE" | tr '[:lower:]' '[:upper:]')" \
      --arg date "$WEEK_START_DATE" \
      --arg start "08:00:00" \
      --arg end "17:00:00" \
      --arg notes "Agent2 Shift for Employee 1" \
      --arg locId "$JOB_SITE_ID" \
      --arg empId "$E1_EMPLOYEE_ID" \
      --arg schedule_id "$SCHEDULE_ID" \
      '{companyCode:$companyCode,date:$date,start:$start,end:$end,notes:$notes,locId:$locId,empId:$empId,crewId:null,schedule_id:$schedule_id}'
  )"
)"
SHIFT_ID="$(echo "$shift_created" | jq -r '.[0].id // empty')"
if [[ -z "$SHIFT_ID" ]]; then
  echo "$shift_created" | jq '.' >&2
  fail "failed to create shift"
fi

shift_verify="$(rest_select "$MA_TOKEN" "shifts?select=id,schedule_id,empId,locId,companyCode&order=createdAt.desc&limit=5")"
if [[ "$(echo "$shift_verify" | jq -r --arg id "$SHIFT_ID" '.[] | select(.id==$id) | .schedule_id' | head -n 1)" != "$SCHEDULE_ID" ]]; then
  fail "shift schedule_id mismatch"
fi
pass "schedule + shift creation persisted"

echo
echo "TEST 4 — Employee 1 My Shifts (RLS)"
e1_email="$(internal_email "$(echo "$COMPANY_A_CODE" | tr '[:lower:]' '[:upper:]')" "$(echo "$EMPLOYEE_1_USERNAME" | tr '[:upper:]' '[:lower:]')")"
e1_auth="$(auth_password_grant "$e1_email" "$EMPLOYEE_1_PIN")"
E1_TOKEN="$(extract_token_or_fail "$e1_auth")"

e1_shifts="$(rest_select "$E1_TOKEN" "shifts?select=id,empId,employee_id,companyCode,company_code,schedule_id&order=date.desc&limit=20")"
seen_other="$(echo "$e1_shifts" | jq -r --arg emp "$E1_EMPLOYEE_ID" '[.[] | select((.empId // .employee_id) != $emp)] | length')"
if [[ "$seen_other" != "0" ]]; then
  echo "$e1_shifts" | jq '.' >&2
  fail "employee can see shifts not belonging to self"
fi
pass "employee shifts isolated by RLS"

echo
echo "TEST 5 — Cross-company isolation (optional)"
COMPANY_B_CODE="${COMPANY_B_CODE:-}"
MANAGER_B_USERNAME="${MANAGER_B_USERNAME:-}"
MANAGER_B_PIN="${MANAGER_B_PIN:-}"
if [[ -n "$COMPANY_B_CODE" && -n "$MANAGER_B_USERNAME" ]]; then
  require_value "MANAGER_B_PIN" "MANAGER_B_PIN (4 digits)" 1
  mb_email="$(internal_email "$(echo "$COMPANY_B_CODE" | tr '[:lower:]' '[:upper:]')" "$(echo "$MANAGER_B_USERNAME" | tr '[:upper:]' '[:lower:]')")"
  mb_auth="$(auth_password_grant "$mb_email" "$MANAGER_B_PIN")"
  MB_TOKEN="$(extract_token_or_fail "$mb_auth")"

  mb_employees="$(rest_select "$MB_TOKEN" "employees?select=id,name&order=name.asc")"
  leak="$(echo "$mb_employees" | jq -r --arg id "$NEW_EMPLOYEE_ID" '[.[] | select(.id==$id)] | length')"
  if [[ "$leak" != "0" ]]; then
    echo "$mb_employees" | jq '.' >&2
    fail "Company B manager can see Company A employee (data leak)"
  fi
  pass "no cross-company leakage detected"
else
  echo "SKIP: Company B creds not provided."
fi

echo
echo "Done."
