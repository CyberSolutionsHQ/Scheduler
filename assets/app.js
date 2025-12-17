/* assets/app.js
   Shared UI + helpers for The Janitor LLC Scheduler
   Requires: assets/store.js
*/

(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const BRAND_NAME = "Cyber Solutions LLC Schedule Manager";

  const escapeHtml = (s = "") =>
    String(s).replace(/[&<>"']/g, m => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[m]));

  const qs = (key) => new URLSearchParams(location.search).get(key);

  function ensureBrandingHeaderText() {
    const header = document.querySelector(".header");
    if (!header) return;

    const h1 = header.querySelector(".h1");
    const h1HasBrand = h1?.textContent && h1.textContent.includes(BRAND_NAME);

    const sub = header.querySelector(".sub");
    if (sub) {
      const already = sub.textContent && sub.textContent.includes(BRAND_NAME);
      if (!already && !h1HasBrand) sub.innerHTML = `${escapeHtml(BRAND_NAME)} • ${sub.innerHTML}`;
      return;
    }

    const host = header.querySelector(".title > div") || header.querySelector(".title") || header;
    const div = document.createElement("div");
    div.className = "sub";
    div.textContent = BRAND_NAME;
    host.appendChild(div);
  }

  /** ---------------------------
   * Auth + Page Guards (local-first)
   * - Supabase-ready: swap provider later without changing page code.
   * ---------------------------
   */
  const Auth = (() => {
    const SESSION_KEY = "csm_session_v1";
    const LAST_COMPANY_KEY = "csm_last_company_v1";
    const PLATFORM_COMPANY_CODE = "PLATFORM";
    const PLATFORM_ADMIN_SETUP_KEY = "CHANGE_ME_LOCAL_SETUP_KEY";

    const safeStorage = {
      get(key) {
        try { return localStorage.getItem(key); } catch {}
        try { return sessionStorage.getItem(key); } catch {}
        return null;
      },
      set(key, val) {
        try { localStorage.setItem(key, val); return true; } catch {}
        try { sessionStorage.setItem(key, val); return true; } catch {}
        return false;
      },
      remove(key) {
        try { localStorage.removeItem(key); return true; } catch {}
        try { sessionStorage.removeItem(key); return true; } catch {}
        return false;
      },
    };

    const readJSON = (key, fallback) => {
      const raw = safeStorage.get(key);
      if (!raw) return fallback;
      try { return JSON.parse(raw); } catch { return fallback; }
    };

    const writeJSON = (key, value) => safeStorage.set(key, JSON.stringify(value));

    const normalizeCompany = (s) => String(s || "").trim().toUpperCase();
    const normalizeUsername = (s) => String(s || "").trim().toLowerCase();

    async function sha256Hex(text) {
      const enc = new TextEncoder();
      if (!globalThis.crypto?.subtle?.digest) return null;
      const buf = await globalThis.crypto.subtle.digest("SHA-256", enc.encode(String(text)));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    function pageNameFromLocation() {
      const p = location.pathname || "";
      const last = p.split("/").filter(Boolean).pop() || "";
      return last || "index.html";
    }

    function homeForRole(role) {
      if (role === "platform_admin") return "admin.html";
      if (role === "employee") return "my-schedule.html";
      return "index.html"; // manager default
    }

    function allowedRolesForPage(pageName) {
      const rules = {
        "login.html": { public: true },
        "index.html": { roles: ["manager"] },
        "employees.html": { roles: ["manager"] },
        "locations.html": { roles: ["manager"] },
        "jobs.html": { roles: ["manager"] },
        "shifts.html": { roles: ["manager"] },
        "export.html": { roles: ["manager"] },
        "crews.html": { roles: ["manager"] },
        "users.html": { roles: ["manager"] },
        "settings.html": { roles: ["manager"] },
        "account.html": { roles: ["manager"] },
        "employee-requests.html": { roles: ["manager"] },
        "print.html": { roles: ["manager", "employee"] },
        "admin.html": { roles: ["platform_admin"] },
        "my-schedule.html": { roles: ["employee"] },
      };
      return rules[pageName] || { roles: ["manager"] };
    }

    function getSession() {
      const s = readJSON(SESSION_KEY, null);
      if (!s || typeof s !== "object") return null;
      if (!s.companyCode || !s.username || !s.role) return null;
      return s;
    }

    function setSession(session) {
      writeJSON(SESSION_KEY, session);
      if (session?.companyCode && normalizeCompany(session.companyCode) !== PLATFORM_COMPANY_CODE) {
        safeStorage.set(LAST_COMPANY_KEY, String(session.companyCode));
      }
      return session;
    }

    function updateSession(patch = {}) {
      const current = getSession();
      if (!current) return null;
      const p = patch && typeof patch === "object" ? patch : {};
      const next = { ...current };
      if (p.username !== undefined) next.username = normalizeUsername(p.username);
      if (p.userId !== undefined) next.userId = p.userId ? String(p.userId) : null;
      if (p.employeeId !== undefined) next.employeeId = p.employeeId ? String(p.employeeId) : null;
      // companyCode/role changes are intentionally not supported here.
      return setSession(next);
    }

    function clearSession() {
      safeStorage.remove(SESSION_KEY);
    }

    function getLastCompanyCode() {
      const raw = safeStorage.get(LAST_COMPANY_KEY);
      return raw ? normalizeCompany(raw) : "";
    }

    async function ensureStoreReady() {
      if (!window.JanitorStore?.init) return false;
      try {
        await window.JanitorStore.init();
        return true;
      } catch {
        return false;
      }
    }

    function getUsersFromSavedStore() {
      const saved = window.JanitorStore?.getSaved?.({ scope: "all" });
      const users = saved?.users;
      return Array.isArray(users) ? users : [];
    }

    function getCompaniesFromSavedStore() {
      const saved = window.JanitorStore?.getSaved?.({ scope: "all" });
      const companies = saved?.companies;
      return Array.isArray(companies) ? companies : [];
    }

    async function hashPin({ companyCode, username, pin }) {
      const cc = normalizeCompany(companyCode);
      const un = normalizeUsername(username);
      const pn = String(pin || "").trim();
      const pinHash = (await sha256Hex(`${cc}:${un}:${pn}`)) || `plain:${pn}`;
      return pinHash;
    }

    function hasAnyPlatformAdmin(users) {
      return (users || []).some(u => String(u.role || "") === "platform_admin");
    }

    async function platformAdminExists() {
      const storeOk = await ensureStoreReady();
      if (!storeOk) return false;
      const users = getUsersFromSavedStore();
      return hasAnyPlatformAdmin(users);
    }

    async function createPlatformAdmin({ username, pin, setupKey }) {
      const un = normalizeUsername(username);
      const pn = String(pin || "").trim();
      const key = String(setupKey || "").trim();

      if (!key) throw new Error("Setup key is required.");
      if (key !== PLATFORM_ADMIN_SETUP_KEY) throw new Error("Invalid setup key.");
      if (!un) throw new Error("Username is required.");
      if (!/^[0-9]{4}$/.test(pn)) throw new Error("PIN must be exactly 4 digits.");

      const storeOk = await ensureStoreReady();
      if (!storeOk) throw new Error("Local storage is unavailable in this browser.");

      const users = getUsersFromSavedStore();
      if (hasAnyPlatformAdmin(users)) {
        throw new Error("Platform admin already exists.");
      }

      const pinHash = await hashPin({ companyCode: PLATFORM_COMPANY_CODE, username: un, pin: pn });
      const created = window.JanitorStore.addUser({
        companyCode: PLATFORM_COMPANY_CODE,
        username: un,
        pinHash,
        role: "platform_admin",
        employeeId: null,
      });
      await window.JanitorStore.save();

      return setSession({
        companyCode: PLATFORM_COMPANY_CODE,
        username: un,
        userId: created?.id || null,
        role: "platform_admin",
        employeeId: null,
        signedInAt: new Date().toISOString(),
        provider: "local",
        createdNewUser: true,
      });
    }

    function assertSetupKey(setupKey) {
      const key = String(setupKey || "").trim();
      if (!key) throw new Error("Master setup key is required.");
      if (key !== PLATFORM_ADMIN_SETUP_KEY) throw new Error("Invalid master setup key.");
      return key;
    }

    async function recoveryListCompanies({ setupKey } = {}) {
      assertSetupKey(setupKey);
      const storeOk = await ensureStoreReady();
      if (!storeOk) throw new Error("Local storage is unavailable in this browser.");

      const companies = getCompaniesFromSavedStore()
        .filter(c => normalizeCompany(c.companyCode) && normalizeCompany(c.companyCode) !== PLATFORM_COMPANY_CODE)
        .map(c => ({
          id: c.id || null,
          companyCode: normalizeCompany(c.companyCode),
          companyName: String(c.companyName || "").trim(),
          isDisabled: !!c.isDisabled,
        }))
        .sort((a, b) => a.companyCode.localeCompare(b.companyCode));

      return companies;
    }

    async function recoveryListUsers({ setupKey, companyCode } = {}) {
      assertSetupKey(setupKey);
      const storeOk = await ensureStoreReady();
      if (!storeOk) throw new Error("Local storage is unavailable in this browser.");

      const cc = normalizeCompany(companyCode);
      if (!cc) throw new Error("Company code is required.");
      if (cc === PLATFORM_COMPANY_CODE) throw new Error("Recovery for the platform admin is not available here.");

      const users = getUsersFromSavedStore()
        .filter(u => normalizeCompany(u.companyCode) === cc)
        .map(u => ({
          id: u.id || null,
          companyCode: normalizeCompany(u.companyCode),
          username: normalizeUsername(u.username),
          role: String(u.role || "employee"),
          active: u.active !== false,
        }))
        .sort((a, b) => {
          if (a.role !== b.role) return a.role.localeCompare(b.role);
          return a.username.localeCompare(b.username);
        });

      return users;
    }

    async function recoveryResetPin({ setupKey, companyCode, username, newPin } = {}) {
      assertSetupKey(setupKey);
      const storeOk = await ensureStoreReady();
      if (!storeOk) throw new Error("Local storage is unavailable in this browser.");

      const cc = normalizeCompany(companyCode);
      const un = normalizeUsername(username);
      const pn = String(newPin || "").trim();

      if (!cc) throw new Error("Company code is required.");
      if (cc === PLATFORM_COMPANY_CODE) throw new Error("Recovery for the platform admin is not available here.");
      if (!un) throw new Error("Username is required.");
      if (!/^[0-9]{4}$/.test(pn)) throw new Error("PIN must be exactly 4 digits.");

      const all = window.JanitorStore.getSaved({ scope: "all" });
      const next = JSON.parse(JSON.stringify(all || {}));
      next.users = Array.isArray(next.users) ? next.users : [];

      const matches = next.users.filter(u =>
        normalizeCompany(u.companyCode) === cc &&
        normalizeUsername(u.username) === un
      );
      if (matches.length === 0) throw new Error("Account not found.");
      if (matches.length > 1) throw new Error("Multiple accounts match. Please use a more specific username.");

      const target = matches[0];
      const pinHash = await hashPin({ companyCode: cc, username: un, pin: pn });

      target.pinHash = pinHash;
      if (target.pin !== undefined) delete target.pin;
      target.active = true;
      target.updatedAt = new Date().toISOString();
      if (!target.createdAt) target.createdAt = target.updatedAt;

      await window.JanitorStore.importJSON(JSON.stringify(next));
      clearSession();
      return { companyCode: cc, username: un };
    }

    async function signInLocal({ companyCode, username, pin }) {
      const cc = normalizeCompany(companyCode);
      const un = normalizeUsername(username);
      const pn = String(pin || "").trim();

      if (!cc) throw new Error("Company code is required.");
      if (!un) throw new Error("Username is required.");
      if (!/^[0-9]{4}$/.test(pn)) throw new Error("PIN must be exactly 4 digits.");

      const storeOk = await ensureStoreReady();
      if (!storeOk) throw new Error("Local storage is unavailable in this browser.");

      const users = getUsersFromSavedStore();
      if (!hasAnyPlatformAdmin(users)) {
        throw new Error("Platform admin setup is required. Please create the platform admin first.");
      }

      const companies = getCompaniesFromSavedStore();
      if (cc !== PLATFORM_COMPANY_CODE) {
        const co = companies.find(c => normalizeCompany(c.companyCode) === cc) || null;
        if (!co) throw new Error("Company code does not exist.");
        if (co.isDisabled) throw new Error("This company code is disabled. Contact support.");
      }

      const companyUsers = users.filter(u => normalizeCompany(u.companyCode) === cc);
      const matches = companyUsers.filter(u => normalizeUsername(u.username) === un);
      if (matches.length > 1) throw new Error("Multiple accounts match this username. Ask your manager to fix it.");

      const user = matches[0] || null;
      const pinHash = await hashPin({ companyCode: cc, username: un, pin: pn });

      if (user) {
        if (user.active === false) throw new Error("This account is deactivated.");
        const storedHash = String(user.pinHash || user.pin || "").trim();
        if (!storedHash || storedHash !== pinHash) throw new Error("Invalid username or PIN.");

        const co = cc === PLATFORM_COMPANY_CODE
          ? null
          : (companies.find(c => normalizeCompany(c.companyCode) === cc) || null);

        return setSession({
          companyCode: cc,
          username: un,
          userId: user.id || null,
          role: user.role || "employee",
          employeeId: user.employeeId || null,
          companyId: co?.id || null,
          companyName: co?.companyName || "",
          signedInAt: new Date().toISOString(),
          provider: "local",
        });
      }

      throw new Error("Invalid username or PIN.");
    }

    async function signIn({ companyCode, username, pin }) {
      // Provider selection will be expanded later (Supabase).
      return signInLocal({ companyCode, username, pin });
    }

    function signOut() {
      clearSession();
      go("login.html");
    }

    function safeNext(next) {
      if (!next) return "";
      const s = String(next);
      // Only allow relative same-folder html routes, optional query/hash.
      if (/^[a-z0-9._-]+\.html([?#].*)?$/i.test(s)) return s;
      return "";
    }

    function goAfterLogin({ next } = {}) {
      const session = getSession();
      if (!session) return go("login.html");

      const cleaned = safeNext(next);
      if (cleaned) {
        const targetPage = cleaned.split(/[?#]/)[0];
        const allowed = allowedRolesForPage(targetPage);
        if (allowed?.public) return go(cleaned);
        if (allowed?.roles?.includes(session.role)) return go(cleaned);
      }
      return go(homeForRole(session.role));
    }

    function guardPage() {
      const page = pageNameFromLocation();
      const rule = allowedRolesForPage(page);
      const session = getSession();

      if (rule.public) {
        if (session) return go(homeForRole(session.role));
        return;
      }

      if (!session) {
        const next = `${page}${location.search || ""}${location.hash || ""}`;
        return go(`login.html?next=${encodeURIComponent(next)}`);
      }

      if (Array.isArray(rule.roles) && !rule.roles.includes(session.role)) {
        return go(homeForRole(session.role));
      }
    }

    return {
      BRAND_NAME,
      getSession,
      updateSession,
      signIn,
      signOut,
      guardPage,
      goAfterLogin,
      getLastCompanyCode,
      homeForRole,
      hashPin,
      platformAdminExists,
      createPlatformAdmin,
      recoveryListCompanies,
      recoveryListUsers,
      recoveryResetPin,
    };
  })();

  const downloadBlob = (filename, blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 800);
  };

  const downloadText = (filename, text, mime = "text/plain") => {
    downloadBlob(filename, new Blob([text], { type: mime }));
  };

  /** ---------------------------
   * Toasts
   * ---------------------------
   */
  function ensureToastHost() {
    let host = $("#toastHost");
    if (host) return host;

    host = document.createElement("div");
    host.id = "toastHost";
    host.style.position = "fixed";
    host.style.left = "0";
    host.style.right = "0";
    host.style.bottom = "14px";
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.alignItems = "center";
    host.style.gap = "8px";
    host.style.zIndex = "9999";
    host.style.pointerEvents = "none";
    document.body.appendChild(host);
    return host;
  }

  function toast(message, { type = "info", ms = 2200 } = {}) {
    const host = ensureToastHost();
    const el = document.createElement("div");
    el.className = "toast";
    el.style.pointerEvents = "auto";
    el.style.maxWidth = "92vw";
    el.style.padding = "10px 12px";
    el.style.borderRadius = "14px";
    el.style.border = "1px solid rgba(255,255,255,0.12)";
    el.style.background = "rgba(10,14,20,0.92)";
    el.style.color = "#e8eef7";
    el.style.fontFamily = "system-ui, Arial, sans-serif";
    el.style.fontSize = "13px";
    el.style.boxShadow = "0 10px 24px rgba(0,0,0,0.35)";
    el.style.backdropFilter = "blur(10px)";
    el.style.transform = "translateY(6px)";
    el.style.opacity = "0";
    el.style.transition = "opacity 120ms ease, transform 120ms ease";

    let badge = "";
    if (type === "success") badge = "✅ ";
    if (type === "error") badge = "⛔ ";
    if (type === "warn") badge = "⚠️ ";

    el.innerHTML = `${badge}${escapeHtml(message)}`;
    host.appendChild(el);

    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });

    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateY(6px)";
      setTimeout(() => el.remove(), 160);
    }, ms);
  }

  /** ---------------------------
   * Save Bar (common)
   * - include <div id="saveBar"></div> in your page
   *   OR it will auto-create at bottom.
   * ---------------------------
   */
  function ensureSaveBar() {
    let bar = $("#saveBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "saveBar";
      document.body.appendChild(bar);
    }

    // Build UI only once
    if (bar.dataset.built === "1") return bar;
    bar.dataset.built = "1";

    bar.style.position = "sticky";
    bar.style.bottom = "0";
    bar.style.left = "0";
    bar.style.right = "0";
    bar.style.padding = "10px 12px";
    bar.style.background = "rgba(14, 21, 32, 0.96)";
    bar.style.borderTop = "1px solid rgba(255,255,255,0.10)";
    bar.style.backdropFilter = "blur(10px)";
    bar.style.display = "flex";
    bar.style.gap = "10px";
    bar.style.alignItems = "center";
    bar.style.justifyContent = "space-between";
    bar.style.zIndex = "1000";

    bar.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:2px;">
        <div style="font-weight:700; font-size:13px;">Unsaved changes</div>
        <div id="saveBarHint" style="font-size:12px; opacity:.75;">Make changes, then tap Save.</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button id="discardBtn" type="button"
          style="padding:10px 12px; border-radius:12px; border:1px solid rgba(255,255,255,0.18);
                 background:rgba(10,17,26,0.9); color:#e8eef7; font-weight:700;">
          Discard
        </button>
        <button id="saveBtn" type="button"
          style="padding:10px 14px; border-radius:12px; border:1px solid rgba(120,200,255,0.35);
                 background:rgba(19,34,54,0.95); color:#e8eef7; font-weight:800;">
          Save
        </button>
      </div>
    `;

    return bar;
  }

  function setSaveBarVisible(visible) {
    const bar = ensureSaveBar();
    bar.style.display = visible ? "flex" : "none";
  }

  function setSaveBarState({ dirty }) {
    const saveBtn = $("#saveBtn");
    const discardBtn = $("#discardBtn");
    const hint = $("#saveBarHint");
    if (!saveBtn || !discardBtn || !hint) return;

    if (dirty) {
      saveBtn.disabled = false;
      discardBtn.disabled = false;
      saveBtn.style.opacity = "1";
      discardBtn.style.opacity = "1";
      hint.textContent = "You have unsaved changes.";
      setSaveBarVisible(true);
    } else {
      saveBtn.disabled = true;
      discardBtn.disabled = true;
      saveBtn.style.opacity = "0.6";
      discardBtn.style.opacity = "0.6";
      hint.textContent = "All changes saved.";
      // Keep bar hidden when clean (better on mobile)
      setSaveBarVisible(false);
    }
  }

  /** ---------------------------
   * App Init
   * ---------------------------
   */
  function updateRequestBadges() {
    const session = Auth.getSession();
    const nodes = (kind) => Array.from(document.querySelectorAll(`[data-badge="${kind}"]`));
    const set = (kind, count) => {
      const els = nodes(kind);
      for (const el of els) {
        const n = Number(count || 0);
        if (!n) {
          el.textContent = "";
          el.style.display = "none";
        } else {
          el.textContent = String(n);
          el.style.display = "inline-flex";
        }
      }
    };

    if (!session || !window.JanitorStore?.getSaved) {
      set("managerRequests", 0);
      set("employeeRequests", 0);
      return;
    }

    try {
      if (session.role === "platform_admin") {
        const s = window.JanitorStore.getSaved({ scope: "all" });
        const rows = Array.isArray(s?.requests) ? s.requests : [];
        const pending = rows.filter(r => String(r.status || "") === "pending" && String(r.type || "") === "manager_change_credentials").length;
        set("managerRequests", pending);
        set("employeeRequests", 0);
        return;
      }

      if (session.role === "manager") {
        const s = window.JanitorStore.getSaved();
        const rows = Array.isArray(s?.requests) ? s.requests : [];
        const pending = rows.filter(r => String(r.status || "") === "pending" && String(r.type || "") === "employee_change_credentials").length;
        set("employeeRequests", pending);
        set("managerRequests", 0);
        return;
      }
    } catch {}

    set("managerRequests", 0);
    set("employeeRequests", 0);
  }

  async function init({
    pageTitle = "",
    requireManager = false, // reserved for later auth
    wireSaveBar = true,
  } = {}) {
    // Guard before any page code runs
    Auth.guardPage();

    // Init store
    await window.JanitorStore.init();

    // Title
    if (pageTitle) document.title = pageTitle;

    updateRequestBadges();

    // Save bar
    if (wireSaveBar) {
      ensureSaveBar();
      setSaveBarState({ dirty: window.JanitorStore.isDirty() });

      // Save button handler
      $("#saveBtn")?.addEventListener("click", async () => {
        try {
          await window.JanitorStore.save();
          toast("Saved ✅", { type: "success" });
          setSaveBarState({ dirty: false });
          updateRequestBadges();
        } catch (e) {
          toast(e.message || "Save failed.", { type: "error" });
        }
      });

      // Discard handler
      $("#discardBtn")?.addEventListener("click", async () => {
        try {
          await window.JanitorStore.resetDraftToSaved();
          toast("Changes discarded.", { type: "warn" });
          setSaveBarState({ dirty: false });

          // Pages can listen for this to re-render
          window.dispatchEvent(new CustomEvent("janitor:discard"));
          updateRequestBadges();
        } catch (e) {
          toast(e.message || "Discard failed.", { type: "error" });
        }
      });

      // When page code edits data, call JanitorApp.markDirty()
      // which updates the save bar.
      window.addEventListener("janitor:dirty", () => {
        setSaveBarState({ dirty: true });
      });
    }

    // Expose a small readiness event
    window.dispatchEvent(new CustomEvent("janitor:ready"));
  }

  /** ---------------------------
   * Dirty helper
   * ---------------------------
   */
  function markDirty() {
    // Store already marks dirty internally, but pages should call this after edits
    // to update the save bar right away.
    window.dispatchEvent(new CustomEvent("janitor:dirty"));
  }

  /** ---------------------------
   * Navigation helper
   * ---------------------------
   */
  function go(page) { window.location.href = page; }

  /** ---------------------------
   * Confirm helper (mobile friendly)
   * ---------------------------
   */
  async function confirmBox(message) {
    return window.confirm(message);
  }

  /** ---------------------------
   * Public API
   * ---------------------------
   */
  window.JanitorApp = {
    init,
    toast,
    markDirty,
    go,
    qs,
    escapeHtml,
    downloadText,
    downloadBlob,
    confirmBox,
    $, $$,
    updateRequestBadges,
  };

  // Expose auth + run guard ASAP on pages that don't call init()
  window.JanitorAuth = Auth;
  ensureBrandingHeaderText();
  Auth.guardPage();
})();
