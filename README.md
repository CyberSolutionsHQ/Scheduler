# Schedule Manager

## Production lock (GitHub Pages)

This repo is deployed to GitHub Pages under `/Scheduler/`.

To prevent the production site from ever accidentally pointing to local Supabase:

- `js/config.js` is committed and must contain **only** the cloud `SUPABASE_URL` + project anon key.
- `js/supabaseClient.js` hard-fails (with a visible full-page error) on any non-localhost site if:
  - `SUPABASE_URL` points at `localhost`/local dev ports, or
  - `SUPABASE_URL` is not `https://xwroayzhbbwbiuswtuvs.supabase.co`.
- `service-worker.js` is versioned and forces `js/config.js` to be fetched with `cache: "no-store"` to avoid stale cached config.

If the site looks “stuck” on an old config after a deploy:

1) Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (macOS)
2) Clear the Service Worker + caches:
   - Chrome: DevTools → Application → Service Workers → **Unregister**
   - DevTools → Application → Storage → **Clear site data**

## Cloud test scripts (no secrets committed)

- `scripts/bootstrap_platform_admin_cloud.sh` bootstraps the first platform admin via the deployed Edge Function.
- `scripts/cloud_lifecycle_test.sh` runs an end-to-end lifecycle test using Edge Functions + Auth + PostgREST.

Both scripts require env vars (anon key + PINs/tokens) and will not print access tokens.
