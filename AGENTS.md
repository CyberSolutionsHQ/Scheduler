# Schedule Manager (Supabase Backend)

## Multi-tenant rules
- Every tenant-scoped table must include `company_code` (or generated alias) and enforce isolation by it.
- Row Level Security (RLS) must be enabled and forced on all tenant tables.
- Policies must prevent cross-company access; use the helper `public.current_company_code()` (Strategy B).

## Migrations-only workflow
- Make all DB changes via Supabase CLI migrations in `supabase/migrations/`.
- Create migrations with `supabase migration new <name>` and apply with `supabase db push --local`.
- Never make schema/policy changes manually in Studio.

## Secrets hygiene
- Never commit secrets (`.env*`, `service_role` keys, `supabase/.temp`).
