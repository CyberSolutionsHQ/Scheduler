import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm";
import {
  SUPABASE_URL as STATIC_SUPABASE_URL,
  SUPABASE_ANON_KEY as STATIC_SUPABASE_ANON_KEY,
  SUPABASE_PROJECT_REF as STATIC_SUPABASE_PROJECT_REF,
} from "./config.js";

function getRuntimeConfig() {
  if (typeof globalThis === "undefined") return {};
  const runtime = globalThis.RUNTIME_CONFIG;
  if (!runtime || typeof runtime !== "object") return {};
  return runtime;
}

function normalizeConfigValue(value) {
  return String(value ?? "").trim();
}

const runtimeConfig = getRuntimeConfig();
const hasRuntimeConfig = Boolean(runtimeConfig && Object.keys(runtimeConfig).length > 0);
const SUPABASE_URL = normalizeConfigValue(runtimeConfig.SUPABASE_URL || STATIC_SUPABASE_URL);
const SUPABASE_ANON_KEY = normalizeConfigValue(runtimeConfig.SUPABASE_ANON_KEY || STATIC_SUPABASE_ANON_KEY);
const SUPABASE_PROJECT_REF = normalizeConfigValue(
  runtimeConfig.SUPABASE_PROJECT_REF || STATIC_SUPABASE_PROJECT_REF,
);

function isUnsafeSupabaseUrl(url) {
  const u = String(url ?? "").toLowerCase();
  return u.includes("localhost") || u.includes("127.0.0.1") || u.includes(":54321");
}

function isLocalHostname(hostname) {
  const h = String(hostname ?? "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

const CONFIG_WARNING_ID = "runtimeConfigWarning";

function renderConfigWarning(message) {
  try {
    const host = document.body || document.documentElement;
    if (!host) return;
    let banner = document.getElementById(CONFIG_WARNING_ID);
    if (!banner) {
      banner = document.createElement("div");
      banner.id = CONFIG_WARNING_ID;
      banner.style.cssText = [
        "position:fixed",
        "top:0",
        "left:0",
        "right:0",
        "z-index:999999",
        "background:#2b1b08",
        "color:#ffd48a",
        "border-bottom:1px solid #5b3a0b",
        "padding:10px 14px",
        "font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
        "font-size:12px",
        "line-height:1.4",
      ].join(";");
      if (host.firstChild) host.insertBefore(banner, host.firstChild);
      else host.appendChild(banner);
    }
    banner.textContent = String(message);
  } catch {
    // ignore rendering errors
  }
}

function projectRefFromUrl() {
  if (!SUPABASE_URL) return "";
  try {
    const host = new URL(SUPABASE_URL).hostname || "";
    return host.split(".")[0] || "";
  } catch {
    return "";
  }
}

function enforceProductionSupabaseLock() {
  if (typeof location === "undefined") return true;
  if (isLocalHostname(location.hostname)) return true;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    renderConfigWarning(
      "Supabase configuration is missing. Set repo secrets SUPABASE_URL and SUPABASE_ANON_KEY for GitHub Pages.",
    );
    return false;
  }

  if (isUnsafeSupabaseUrl(SUPABASE_URL)) {
    renderConfigWarning(
      "Refusing to use local Supabase URL on this site. Update SUPABASE_URL.",
    );
    return false;
  }

  try {
    const url = new URL(SUPABASE_URL);
    if (url.protocol !== "https:") {
      renderConfigWarning("SUPABASE_URL must be https.");
      return false;
    }
    const projectRef = String(SUPABASE_PROJECT_REF || projectRefFromUrl()).trim();
    if (projectRef) {
      const expectedHost = `${projectRef}.supabase.co`.toLowerCase();
      if (url.hostname.toLowerCase() !== expectedHost) {
        renderConfigWarning(`SUPABASE_URL must point to ${expectedHost}.`);
        return false;
      }
    }
  } catch {
    renderConfigWarning("SUPABASE_URL is not a valid URL.");
    return false;
  }

  return true;
}

if (!hasRuntimeConfig && typeof location !== "undefined" && !isLocalHostname(location.hostname)) {
  renderConfigWarning(
    "runtime-config.js was not found. Using js/config.js fallback. Set GitHub Pages secrets SUPABASE_URL and SUPABASE_ANON_KEY.",
  );
}

const canUseSupabase = enforceProductionSupabaseLock();

function registerServiceWorker() {
  const ENABLE_OFFLINE = false;
  if (!ENABLE_OFFLINE) return;
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (typeof location !== "undefined" && isLocalHostname(location.hostname)) return;

  const swUrl = new URL("../service-worker.js", import.meta.url);
  navigator.serviceWorker.register(swUrl.href).catch(() => {
    // ignore
  });
}

registerServiceWorker();

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && canUseSupabase);

function createUnavailableSupabase(message) {
  const errorResult = { data: null, error: { message } };
  const builder = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve, reject) => Promise.resolve(errorResult).then(resolve, reject);
        }
        return () => builder;
      },
    },
  );

  return {
    auth: {
      getSession: async () => errorResult,
      setSession: async () => errorResult,
      signOut: async () => errorResult,
      getUser: async () => errorResult,
      updateUser: async () => errorResult,
    },
    functions: {
      invoke: async () => errorResult,
    },
    from: () => builder,
    rpc: async () => errorResult,
  };
}

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
  : createUnavailableSupabase(
      "Supabase is not configured for this site. Set repo secrets SUPABASE_URL and SUPABASE_ANON_KEY.",
    );

export function getSupabase() {
  return supabase;
}
