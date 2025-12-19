import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm";
import { SUPABASE_ANON_KEY, SUPABASE_PROJECT_REF, SUPABASE_URL } from "./config.js";

function isUnsafeSupabaseUrl(url) {
  const u = String(url ?? "").toLowerCase();
  return u.includes("localhost") || u.includes("127.0.0.1") || u.includes(":54321");
}

function isLocalHostname(hostname) {
  const h = String(hostname ?? "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

function renderFatalConfigError(message) {
  try {
    const host = document.body || document.documentElement;
    const box = document.createElement("div");
    box.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:999999",
      "background:#0e1520",
      "color:#ffdf9f",
      "padding:24px",
      "font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
      "line-height:1.4",
    ].join(";");
    box.innerHTML = `
      <h2 style="margin:0 0 12px 0;color:#fff;">Configuration Error</h2>
      <div style="max-width:900px;">
        <div style="margin-bottom:12px;">${String(message)}</div>
        <pre style="white-space:pre-wrap;background:#08101a;color:#cfe3ff;padding:12px;border-radius:8px;overflow:auto;">SUPABASE_URL: ${String(SUPABASE_URL)}</pre>
        <div style="margin-top:12px;">
          Fix: provide an anon key for production (without committing it). Recommended: GitHub Pages deploy via
          <code>.github/workflows/deploy_github_pages.yml</code> with repo secret <code>SUPABASE_ANON_KEY</code>, then hard refresh.
        </div>
      </div>
    `;
    host.appendChild(box);
  } catch {
    // ignore rendering errors
  }
  throw new Error(String(message));
}

function enforceProductionSupabaseLock() {
  if (typeof location === "undefined") return;
  if (isLocalHostname(location.hostname)) return;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    renderFatalConfigError("Missing Supabase configuration for production.");
  }

  if (isUnsafeSupabaseUrl(SUPABASE_URL)) {
    renderFatalConfigError(
      "Refusing to run in production: SUPABASE_URL points to localhost.",
    );
  }

  try {
    const url = new URL(SUPABASE_URL);
    if (url.protocol !== "https:") {
      renderFatalConfigError("Refusing to run: SUPABASE_URL must be https.");
    }
    const expectedHost = `${String(SUPABASE_PROJECT_REF)}.supabase.co`.toLowerCase();
    if (url.hostname.toLowerCase() !== expectedHost) {
      renderFatalConfigError(
        `Refusing to run: SUPABASE_URL must point to ${expectedHost}.`,
      );
    }
  } catch {
    renderFatalConfigError("Refusing to run: SUPABASE_URL is not a valid URL.");
  }
}

enforceProductionSupabaseLock();

function registerServiceWorker() {
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (typeof location !== "undefined" && isLocalHostname(location.hostname)) return;

  const swUrl = new URL("../service-worker.js", import.meta.url);
  navigator.serviceWorker.register(swUrl.href).catch(() => {
    // ignore
  });
}

registerServiceWorker();

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
