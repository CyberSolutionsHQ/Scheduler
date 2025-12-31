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

### Security headers plan

GitHub Pages does not support custom response headers, so this site should be served
through a CDN/proxy (for example, Cloudflare) that can set security headers.

Required headers (set at the CDN/proxy):
- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `Referrer-Policy`

Baseline CSP (adjust if new third-party assets are added):
```
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data:; font-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'
```

## Supabase

Edge functions live in `supabase/functions/` and are aligned with `context_logs/api_contract.json`.
