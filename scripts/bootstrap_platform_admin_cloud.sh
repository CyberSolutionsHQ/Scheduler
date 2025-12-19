#!/usr/bin/env bash
set -euo pipefail

# Bootstraps the FIRST platform admin via the deployed Edge Function.
#
# Requirements:
# - Cloud project is linked (supabase/.temp/project-ref exists)
# - Supabase anon key (public) is available
# - BOOTSTRAP_TOKEN secret exists in Supabase Edge Function secrets
#
# Usage (copy/paste):
#   export SUPABASE_ANON_KEY='...'
#   export PLATFORM_ADMIN_USERNAME='admin'
#   export PLATFORM_ADMIN_EMAIL='admin@example.com' # optional; defaults to internal email
#   export PLATFORM_ADMIN_AUTH_USER_ID='...'        # optional; promote an existing auth user
#   ./scripts/bootstrap_platform_admin_cloud.sh

PROJECT_REF="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
if [[ -z "${PROJECT_REF}" ]]; then
  echo "Missing supabase/.temp/project-ref (run: supabase link --project-ref ...)" >&2
  exit 1
fi

: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY (public anon key)}"
: "${PLATFORM_ADMIN_USERNAME:=admin}"
: "${PLATFORM_ADMIN_EMAIL:=}"
: "${PLATFORM_ADMIN_AUTH_USER_ID:=}"

if [[ -z "${BOOTSTRAP_TOKEN:-}" ]]; then
  read -s -p "BOOTSTRAP_TOKEN: " BOOTSTRAP_TOKEN
  echo
fi

if [[ -z "${PLATFORM_ADMIN_PIN:-}" ]]; then
  read -s -p "PLATFORM_ADMIN_PIN (4 digits): " PLATFORM_ADMIN_PIN
  echo
fi

FUNC_URL="https://${PROJECT_REF}.functions.supabase.co/bootstrap_platform_admin"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

payload="$(
  if command -v jq >/dev/null 2>&1; then
    if [[ -n "$PLATFORM_ADMIN_EMAIL" && -n "$PLATFORM_ADMIN_AUTH_USER_ID" ]]; then
      jq -n \
        --arg token "$BOOTSTRAP_TOKEN" \
        --arg email "$PLATFORM_ADMIN_EMAIL" \
        --arg authUserId "$PLATFORM_ADMIN_AUTH_USER_ID" \
        --arg username "$PLATFORM_ADMIN_USERNAME" \
        --arg pin "$PLATFORM_ADMIN_PIN" \
        '{token:$token,email:$email,authUserId:$authUserId,username:$username,pin:$pin}'
    elif [[ -n "$PLATFORM_ADMIN_EMAIL" ]]; then
      jq -n \
        --arg token "$BOOTSTRAP_TOKEN" \
        --arg email "$PLATFORM_ADMIN_EMAIL" \
        --arg username "$PLATFORM_ADMIN_USERNAME" \
        --arg pin "$PLATFORM_ADMIN_PIN" \
        '{token:$token,email:$email,username:$username,pin:$pin}'
    elif [[ -n "$PLATFORM_ADMIN_AUTH_USER_ID" ]]; then
      jq -n \
        --arg token "$BOOTSTRAP_TOKEN" \
        --arg authUserId "$PLATFORM_ADMIN_AUTH_USER_ID" \
        --arg username "$PLATFORM_ADMIN_USERNAME" \
        --arg pin "$PLATFORM_ADMIN_PIN" \
        '{token:$token,authUserId:$authUserId,username:$username,pin:$pin}'
    else
      jq -n \
        --arg token "$BOOTSTRAP_TOKEN" \
        --arg username "$PLATFORM_ADMIN_USERNAME" \
        --arg pin "$PLATFORM_ADMIN_PIN" \
        '{token:$token,username:$username,pin:$pin}'
    fi
  else
    if [[ -n "$PLATFORM_ADMIN_EMAIL" && -n "$PLATFORM_ADMIN_AUTH_USER_ID" ]]; then
      printf '{"token":"%s","email":"%s","authUserId":"%s","username":"%s","pin":"%s"}' \
        "$BOOTSTRAP_TOKEN" \
        "$PLATFORM_ADMIN_EMAIL" \
        "$PLATFORM_ADMIN_AUTH_USER_ID" \
        "$PLATFORM_ADMIN_USERNAME" \
        "$PLATFORM_ADMIN_PIN"
    elif [[ -n "$PLATFORM_ADMIN_EMAIL" ]]; then
      printf '{"token":"%s","email":"%s","username":"%s","pin":"%s"}' \
        "$BOOTSTRAP_TOKEN" \
        "$PLATFORM_ADMIN_EMAIL" \
        "$PLATFORM_ADMIN_USERNAME" \
        "$PLATFORM_ADMIN_PIN"
    elif [[ -n "$PLATFORM_ADMIN_AUTH_USER_ID" ]]; then
      printf '{"token":"%s","authUserId":"%s","username":"%s","pin":"%s"}' \
        "$BOOTSTRAP_TOKEN" \
        "$PLATFORM_ADMIN_AUTH_USER_ID" \
        "$PLATFORM_ADMIN_USERNAME" \
        "$PLATFORM_ADMIN_PIN"
    else
      printf '{"token":"%s","username":"%s","pin":"%s"}' \
        "$BOOTSTRAP_TOKEN" \
        "$PLATFORM_ADMIN_USERNAME" \
        "$PLATFORM_ADMIN_PIN"
    fi
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
  if command -v jq >/dev/null 2>&1; then
    jq 'del(.pin, .managerPin, .newPin, .access_token, .refresh_token, .provider_token, .provider_refresh_token)' \
      <"$tmp" >&2 || cat "$tmp" >&2
  else
    sed -E \
      -e 's/"pin"[[:space:]]*:[[:space:]]*"[^"]*"/"pin":"[REDACTED]"/g' \
      -e 's/"managerPin"[[:space:]]*:[[:space:]]*"[^"]*"/"managerPin":"[REDACTED]"/g' \
      -e 's/"newPin"[[:space:]]*:[[:space:]]*"[^"]*"/"newPin":"[REDACTED]"/g' \
      "$tmp" >&2
  fi
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  jq 'del(.pin, .managerPin, .newPin, .access_token, .refresh_token, .provider_token, .provider_refresh_token)' \
    <"$tmp"
else
  # Best-effort redaction if jq isn't installed.
  sed -E \
    -e 's/"pin"[[:space:]]*:[[:space:]]*"[^"]*"/"pin":"[REDACTED]"/g' \
    -e 's/"managerPin"[[:space:]]*:[[:space:]]*"[^"]*"/"managerPin":"[REDACTED]"/g' \
    -e 's/"newPin"[[:space:]]*:[[:space:]]*"[^"]*"/"newPin":"[REDACTED]"/g' \
    "$tmp"
fi
