#!/usr/bin/env bash
set -euo pipefail

# Deploys Cloud migrations + updated Edge Function, then promotes an existing Auth user
# into the PLATFORM platform_admin app role via the bootstrap_platform_admin function.
#
# Secrets are prompted via `read -s` and never echoed.
#
# Requirements:
# - Supabase CLI installed
# - supabase/.temp/project-ref exists and matches the target project
# - BOOTSTRAP_TOKEN is set as an Edge Function secret in Supabase (same as used by the function)
#
# Usage:
#   export SUPABASE_ANON_KEY='...'
#   ./scripts/deploy_and_promote_platform_admin_cloud.sh

EXPECTED_PROJECT_REF="xwroayzhbbwbiuswtuvs"
PROJECT_REF="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
if [[ -z "$PROJECT_REF" ]]; then
  echo "Missing supabase/.temp/project-ref" >&2
  exit 1
fi
if [[ "$PROJECT_REF" != "$EXPECTED_PROJECT_REF" ]]; then
  echo "Wrong project-ref: expected $EXPECTED_PROJECT_REF got $PROJECT_REF" >&2
  exit 1
fi

: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY (public anon key)}"

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
SUPABASE_ACCESS_TOKEN_FILE="${SUPABASE_ACCESS_TOKEN_FILE:-supabase/.temp/supabase_access_token}"
if [[ -z "$SUPABASE_ACCESS_TOKEN" && -f "$SUPABASE_ACCESS_TOKEN_FILE" ]]; then
  SUPABASE_ACCESS_TOKEN="$(cat "$SUPABASE_ACCESS_TOKEN_FILE")"
fi
if [[ -z "$SUPABASE_ACCESS_TOKEN" ]]; then
  if [[ ! -t 0 ]]; then
    echo "Missing SUPABASE_ACCESS_TOKEN and no TTY available." >&2
    echo "Create $SUPABASE_ACCESS_TOKEN_FILE with a token (use read -s) or export SUPABASE_ACCESS_TOKEN." >&2
    exit 1
  fi
  read -s -p "SUPABASE_ACCESS_TOKEN: " SUPABASE_ACCESS_TOKEN
  echo
fi
export SUPABASE_ACCESS_TOKEN

supabase link --project-ref "$PROJECT_REF" --yes >/dev/null
supabase db push --linked --yes
supabase functions deploy bootstrap_platform_admin --project-ref "$PROJECT_REF" --use-api --yes

echo
echo "Promote existing Auth user to PLATFORM platform_admin"
echo "(username will be normalized to lowercase in DB)"

PLATFORM_ADMIN_AUTH_USER_ID="${PLATFORM_ADMIN_AUTH_USER_ID:-03e235ac-c709-4226-b137-704ba20ad3be}"
PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-cybersolutionsllc228@gmail.com}"
PLATFORM_ADMIN_USERNAME="${PLATFORM_ADMIN_USERNAME:-Admin}"

BOOTSTRAP_TOKEN="${BOOTSTRAP_TOKEN:-}"
BOOTSTRAP_TOKEN_FILE="${BOOTSTRAP_TOKEN_FILE:-supabase/.temp/bootstrap_token}"
if [[ -z "$BOOTSTRAP_TOKEN" && -f "$BOOTSTRAP_TOKEN_FILE" ]]; then
  BOOTSTRAP_TOKEN="$(cat "$BOOTSTRAP_TOKEN_FILE")"
fi
if [[ -z "$BOOTSTRAP_TOKEN" ]]; then
  if [[ ! -t 0 ]]; then
    echo "Missing BOOTSTRAP_TOKEN and no TTY available." >&2
    echo "Create $BOOTSTRAP_TOKEN_FILE (use read -s) or export BOOTSTRAP_TOKEN." >&2
    exit 1
  fi
  read -s -p "BOOTSTRAP_TOKEN: " BOOTSTRAP_TOKEN
  echo
fi

PLATFORM_ADMIN_PIN="${PLATFORM_ADMIN_PIN:-}"
PLATFORM_ADMIN_PIN_FILE="${PLATFORM_ADMIN_PIN_FILE:-supabase/.temp/platform_admin_pin}"
if [[ -z "$PLATFORM_ADMIN_PIN" && -f "$PLATFORM_ADMIN_PIN_FILE" ]]; then
  PLATFORM_ADMIN_PIN="$(cat "$PLATFORM_ADMIN_PIN_FILE")"
fi
if [[ -z "$PLATFORM_ADMIN_PIN" ]]; then
  if [[ ! -t 0 ]]; then
    echo "Missing PLATFORM_ADMIN_PIN and no TTY available." >&2
    echo "Create $PLATFORM_ADMIN_PIN_FILE (use read -s) or export PLATFORM_ADMIN_PIN." >&2
    exit 1
  fi
  read -s -p "PLATFORM_ADMIN_PIN (4 digits): " PLATFORM_ADMIN_PIN
  echo
fi

FUNC_URL="https://${PROJECT_REF}.functions.supabase.co/bootstrap_platform_admin"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

payload="$(
  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --arg token "$BOOTSTRAP_TOKEN" \
      --arg authUserId "$PLATFORM_ADMIN_AUTH_USER_ID" \
      --arg email "$PLATFORM_ADMIN_EMAIL" \
      --arg username "$PLATFORM_ADMIN_USERNAME" \
      --arg pin "$PLATFORM_ADMIN_PIN" \
      '{token:$token,authUserId:$authUserId,email:$email,username:$username,pin:$pin}'
  else
    printf '{"token":"%s","authUserId":"%s","email":"%s","username":"%s","pin":"%s"}' \
      "$BOOTSTRAP_TOKEN" \
      "$PLATFORM_ADMIN_AUTH_USER_ID" \
      "$PLATFORM_ADMIN_EMAIL" \
      "$PLATFORM_ADMIN_USERNAME" \
      "$PLATFORM_ADMIN_PIN"
  fi
)"

http_code="$(
  curl -sS -X POST "$FUNC_URL" \
    -H "content-type: application/json" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    --data-binary @- \
    -o "$tmp" -w "%{http_code}"
  <<<"$payload"
)"

if [[ "$http_code" != 2* ]]; then
  echo "bootstrap_platform_admin failed (HTTP $http_code):" >&2
  cat "$tmp" >&2
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  jq 'del(.pin)' <"$tmp"
else
  sed -E 's/"pin"[[:space:]]*:[[:space:]]*"[^"]*"/"pin":"[REDACTED]"/g' "$tmp"
fi
