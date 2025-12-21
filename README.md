# Schedule Manager

## Frontend

Static assets live in `public/` and are deployed to GitHub Pages.

### Local development (no secrets committed)

1) Create a local `.env` with:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_PROJECT_REF` (optional)
2) Generate the runtime config:
   - `python scripts/generate_runtime_config.py`
3) Serve `public/` with any static server.

### GitHub Pages

- Set repo secrets: `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- The Pages workflow writes `public/runtime-config.js` at deploy time.
- Pages can be served from a subpath; all links are relative.

## Supabase

Edge functions live in `supabase/functions/` and are aligned with `context_logs/api_contract.json`.
