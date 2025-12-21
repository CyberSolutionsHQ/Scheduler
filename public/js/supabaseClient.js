import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm";

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
const SUPABASE_URL = normalizeConfigValue(runtimeConfig.SUPABASE_URL);
const SUPABASE_ANON_KEY = normalizeConfigValue(runtimeConfig.SUPABASE_ANON_KEY);
const SUPABASE_PROJECT_REF = normalizeConfigValue(runtimeConfig.SUPABASE_PROJECT_REF);
const hasRuntimeConfig = Boolean(SUPABASE_URL || SUPABASE_ANON_KEY || SUPABASE_PROJECT_REF);
const hasRequiredConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function isUnsafeSupabaseUrl(url) {
  const u = String(url ?? "").toLowerCase();
  return u.includes("localhost") || u.includes("127.0.0.1") || u.includes(":54321");
}

function isLocalHostname(hostname) {
  const h = String(hostname ?? "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

const CONFIG_WARNING_ID = "runtimeConfigWarning";
const CONFIG_ERROR_ID = "runtimeConfigError";
const MISSING_CONFIG_MESSAGE =
  "Missing SUPABASE_URL / SUPABASE_ANON_KEY. Generate runtime-config.js locally or configure GitHub Pages workflow secrets.";

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

function renderConfigError(message) {
  try {
    const host = document.body || document.documentElement;
    if (!host) return;
    let overlay = document.getElementById(CONFIG_ERROR_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = CONFIG_ERROR_ID;
      overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:999998",
        "background:rgba(10,16,24,0.94)",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "padding:24px",
        "text-align:center",
        "font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
      ].join(";");

      const card = document.createElement("div");
      card.style.cssText = [
        "max-width:640px",
        "background:#120b0b",
        "border:1px solid #6b1e1e",
        "box-shadow:0 18px 40px rgba(0,0,0,0.5)",
        "border-radius:18px",
        "padding:20px 22px",
        "color:#f7d7cf",
      ].join(";");

      const title = document.createElement("div");
      title.textContent = "Configuration Error";
      title.style.cssText = [
        "font-size:18px",
        "font-weight:700",
        "letter-spacing:0.2px",
        "margin-bottom:8px",
      ].join(";");

      const body = document.createElement("div");
      body.dataset.runtimeConfigBody = "true";
      body.textContent = String(message);
      body.style.cssText = [
        "font-size:14px",
        "line-height:1.5",
      ].join(";");

      card.appendChild(title);
      card.appendChild(body);
      overlay.appendChild(card);
      if (host.firstChild) host.insertBefore(overlay, host.firstChild);
      else host.appendChild(overlay);
    } else {
      const body = overlay.querySelector("[data-runtime-config-body]");
      if (body) body.textContent = String(message);
    }
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
    renderConfigError(MISSING_CONFIG_MESSAGE);
    return false;
  }

  if (isUnsafeSupabaseUrl(SUPABASE_URL)) {
    renderConfigError("Refusing to use local Supabase URL on this site. Update SUPABASE_URL.");
    return false;
  }

  try {
    const url = new URL(SUPABASE_URL);
    if (url.protocol !== "https:") {
      renderConfigError("SUPABASE_URL must be https.");
      return false;
    }
    const projectRef = String(SUPABASE_PROJECT_REF || projectRefFromUrl()).trim();
    if (projectRef) {
      const expectedHost = `${projectRef}.supabase.co`.toLowerCase();
      if (url.hostname.toLowerCase() !== expectedHost) {
        renderConfigError(`SUPABASE_URL must point to ${expectedHost}.`);
        return false;
      }
    }
  } catch {
    renderConfigError("SUPABASE_URL is not a valid URL.");
    return false;
  }

  return true;
}

if (!hasRequiredConfig) {
  renderConfigError(MISSING_CONFIG_MESSAGE);
} else if (!hasRuntimeConfig && typeof location !== "undefined" && isLocalHostname(location.hostname)) {
  renderConfigWarning("runtime-config.js is missing. Generate public/runtime-config.js for development.");
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

export const isSupabaseConfigured = Boolean(hasRequiredConfig && canUseSupabase);

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
      "Supabase is not configured. Provide runtime-config.js with SUPABASE_URL and SUPABASE_ANON_KEY.",
    );

export function getSupabase() {
  return supabase;
}
