# GitHub Pages Deploy (No Keys Committed)

This repo intentionally keeps `SUPABASE_ANON_KEY` **out of git history**. Production deploy must inject it at deploy time.

## One-time setup (GitHub)

1) Repo → **Settings → Pages**
- Set **Build and deployment** → **Source** = **GitHub Actions**

2) Repo → **Settings → Secrets and variables → Actions**
- Add **Repository secret**: `SUPABASE_ANON_KEY` (Supabase project anon key)

## Deploy

- Push to `main`/`master`, or run **Actions → Deploy GitHub Pages (no keys in git)** manually.

## Verify

- Open the site and hard refresh (or unregister the Service Worker if you had an older build cached).
- If you still see “Missing Supabase configuration”, confirm the `SUPABASE_ANON_KEY` secret exists and the workflow ran successfully.

