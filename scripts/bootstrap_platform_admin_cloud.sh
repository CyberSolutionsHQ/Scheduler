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
#   export BOOTSTRAP_TOKEN='...'
#   export PLATFORM_ADMIN_USERNAME='admin'
#   export PLATFORM_ADMIN_PIN='1234'   # 4 digits; do NOT reuse in production
#   ./scripts/bootstrap_platform_admin_cloud.sh

PROJECT_REF="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
if [[ -z "${PROJECT_REF}" ]]; then
  echo "Missing supabase/.temp/project-ref (run: supabase link --project-ref ...)" >&2
  exit 1
fi

: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY (public anon key)}"
: "${BOOTSTRAP_TOKEN:?Set BOOTSTRAP_TOKEN (Supabase Edge Function secret)}"
: "${PLATFORM_ADMIN_USERNAME:=admin}"
: "${PLATFORM_ADMIN_PIN:?Set PLATFORM_ADMIN_PIN (4 digits)}"

FUNC_URL="https://${PROJECT_REF}.functions.supabase.co/bootstrap_platform_admin"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

http_code="$(
  curl -sS -X POST "$FUNC_URL" \
    -H "content-type: application/json" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    --data-binary "$(
      printf '{"token":"%s","username":"%s","pin":"%s"}' \
        "$BOOTSTRAP_TOKEN" \
        "$PLATFORM_ADMIN_USERNAME" \
        "$PLATFORM_ADMIN_PIN"
    )" \
    -o "$tmp" -w "%{http_code}"
)"

if [[ "$http_code" != 2* ]]; then
  echo "bootstrap_platform_admin failed (HTTP $http_code):" >&2
  cat "$tmp" >&2
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  jq 'del(.pin)' <"$tmp"
else
  # Best-effort redaction if jq isn't installed.
  sed -E 's/"pin"[[:space:]]*:[[:space:]]*"[^"]*"/"pin":"[REDACTED]"/g' "$tmp"
fi

