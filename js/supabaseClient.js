import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "csm_auth_v1",
      },
      global: { headers: { "X-Client-Info": "schedule-manager-web" } },
    })
  : null;

export function getSupabase() {
  if (supabase) return supabase;
  throw new Error(
    "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js.",
  );
}

