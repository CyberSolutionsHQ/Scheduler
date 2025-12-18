/* assets/store.js
   The Janitor LLC Scheduler - Shared Data Store
   - Draft state + explicit Save (commit)
   - IndexedDB (preferred) with localStorage fallback
*/

(() => {
  "use strict";

  const APP_KEY = "janitor_scheduler_v1";
  const DB_NAME = "janitor_scheduler_db";
  const DB_STORE = "kv";
  const DB_VERSION = 1;
  const SESSION_KEY = "csm_session_v1";

  const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
  const nowISO = () => new Date().toISOString();

  const newId = () => {
    try {
      const v = globalThis.crypto?.randomUUID?.();
      if (v) return v;
    } catch {}
    return `id_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  };
  const uid = () => newId();

  const normalizeCompanyCode = (s) => String(s || "").trim().toUpperCase();

  function readSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || typeof s !== "object") return null;
      return s;
    } catch {
      return null;
    }
  }

  function getActiveCompanyCode() {
    return normalizeCompanyCode(readSession()?.companyCode || "");
  }

  function getActiveRole() {
    return String(readSession()?.role || "");
  }

  function getActiveUserId() {
    return String(readSession()?.userId || "");
  }

  const normalizeUsername = (s) => String(s || "").trim().toLowerCase();

  const parseYMD = (ymd) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!y || !mo || !d) return null;
    const dt = new Date(y, mo - 1, d);
    if (Number.isNaN(dt.getTime())) return null;
    return dt;
  };

  const toYMD = (dt) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const emptyState = () => ({
    meta: {
      appKey: APP_KEY,
      version: 4,
      lastSavedAt: null,
      lastEditedAt: null,
    },
    settings: {
      companyName: "",
    },
    companies: [],   // {id, companyCode, companyName, isDisabled, supportEnabled?, createdAt}
    users: [],       // {id, companyCode, username, pinHash|pin, role, employeeId?, active, createdAt, updatedAt}
    requests: [],    // {id, companyCode, type, status, requesterUserId, targetUserId, proposedUsername?, proposedPin?, createdAt, handledAt?, handledBy?, decisionNote?}
    employees: [],   // {id, companyCode, name, contact, active, createdAt, updatedAt}
    locations: [],   // {id, companyCode, name, address, active, createdAt, updatedAt}
    job_types: [],   // {id, companyCode, name, active, createdAt, updatedAt}
    crews: [],       // {id, companyCode, name, active, createdAt, updatedAt}
    crew_members: [], // {id, companyCode, crewId, employeeId, createdAt}
    shifts: [],      // {id, companyCode, date, start, end, notes, locId, empId|null, crewId|null, createdAt, updatedAt}
    shift_jobs: [],  // {id, companyCode, shiftId, jobTypeId, createdAt}
  });

  /** ---------------------------
   *  Storage Layer
   *  ---------------------------
   *  We store the "saved" state only.
   *  Pages modify a "draft" state in memory.
   *  Save button commits draft -> storage.
   */

  const storage = {
    _mode: "idb", // "idb" or "ls"
    _db: null,

    async init() {
      // Try IndexedDB; if not supported/blocked, fallback to localStorage.
      if (!("indexedDB" in window)) {
        this._mode = "ls";
        return;
      }
      try {
        this._db = await this._openDB();
        this._mode = "idb";
      } catch (e) {
        console.warn("[store] IndexedDB unavailable, falling back to localStorage:", e);
        this._mode = "ls";
      }
    },

    _openDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(DB_STORE)) {
            db.createObjectStore(DB_STORE);
          }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },

    async getSavedState() {
      if (this._mode === "ls") {
        const raw = localStorage.getItem(APP_KEY);
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }

      // IndexedDB
      const db = this._db;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readonly");
        const store = tx.objectStore(DB_STORE);
        const req = store.get(APP_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    },

    async setSavedState(stateObj) {
      if (this._mode === "ls") {
        localStorage.setItem(APP_KEY, JSON.stringify(stateObj));
        return;
      }

      const db = this._db;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        const store = tx.objectStore(DB_STORE);
        const req = store.put(stateObj, APP_KEY);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    },

    async clear() {
      if (this._mode === "ls") {
        localStorage.removeItem(APP_KEY);
        return;
      }
      const db = this._db;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        const store = tx.objectStore(DB_STORE);
        const req = store.delete(APP_KEY);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    },
  };

  /** ---------------------------
   *  Store (Draft + Saved)
   *  ---------------------------
   *  window.JanitorStore
   */

  const Store = {
    _ready: false,
    _saved: null,
    _draft: null,

    // Dirty flags so pages can show "unsaved changes"
    _dirty: false,

    /** ---------------------------
     *  Session + Tenant helpers (store-level contract)
     *  ---------------------------
     */
    getSession() { return readSession(); },

    setSession(session) {
      const s = session && typeof session === "object" ? session : null;
      if (!s) throw new Error("Invalid session.");
      const next = {
        ...s,
        companyCode: normalizeCompanyCode(s.companyCode),
        username: normalizeUsername(s.username),
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      return next;
    },

    clearSession() { localStorage.removeItem(SESSION_KEY); },

    requireAuth(allowedRoles = []) {
      const sess = readSession();
      if (!sess) {
        const next = `${location.pathname.split("/").pop() || "index.html"}${location.search || ""}`;
        location.href = `login.html?next=${encodeURIComponent(next)}`;
        throw new Error("Not signed in.");
      }
      const roles = Array.isArray(allowedRoles) ? allowedRoles : [];
      if (roles.length && !roles.includes(String(sess.role || ""))) {
        location.href = "login.html";
        throw new Error("Not authorized.");
      }
      return sess;
    },

    getCompanyCode() { return getActiveCompanyCode(); },
    normalizeCompanyCode(code) { return normalizeCompanyCode(code); },

    tenantGuard(recordCompanyCode) {
      const rc = normalizeCompanyCode(recordCompanyCode);
      const role = getActiveRole();
      if (role === "platform_admin") return true;
      const cc = getActiveCompanyCode();
      if (!cc || !rc || cc !== rc) throw new Error("Tenant mismatch.");
      return true;
    },

    async init() {
      if (this._ready) return;
      await storage.init();

      const saved = await storage.getSavedState();
      const normalizedSaved = this._normalize(saved || emptyState());
      const hasLegacyShape = (() => {
        if (!saved || typeof saved !== "object") return false;
        const v = Number(saved?.meta?.version || 0);
        if (v && v < 4) return true;
        if (saved.jobTypes || saved.crewMembers) return true;
        if (Array.isArray(saved.shifts) && saved.shifts.some(sh => sh && (sh.targetType || sh.targetId || Array.isArray(sh.jobTypeIds)))) return true;
        return false;
      })();

      if (hasLegacyShape) {
        try {
          normalizedSaved.meta = { ...(normalizedSaved.meta || {}), migratedAt: nowISO() };
          normalizedSaved.meta.lastSavedAt = normalizedSaved.meta.lastSavedAt || nowISO();
          await storage.setSavedState(normalizedSaved);
        } catch {}
      }

      this._saved = deepClone(normalizedSaved);

      // One-time migration: legacy users were stored outside the main state.
      // Move them into the persisted store so RBAC accounts are backed up with the rest of the data.
      try {
        const legacyKey = "csm_users_v1";
        const raw = localStorage.getItem(legacyKey);
        if (raw) {
          const legacyUsers = JSON.parse(raw);
          const hasNoUsers = !Array.isArray(this._saved.users) || this._saved.users.length === 0;
          if (hasNoUsers && Array.isArray(legacyUsers) && legacyUsers.length) {
            const merged = deepClone(this._saved);
            merged.users = legacyUsers;
            const normalized = this._normalize(merged);
            normalized.meta.lastSavedAt = nowISO();
            await storage.setSavedState(normalized);
            this._saved = deepClone(normalized);
            localStorage.removeItem(legacyKey);
          }
        }
      } catch {}

      // Draft starts as clone of saved
      this._draft = deepClone(this._saved);
      this._dirty = false;
      this._ready = true;
    },

    async migrateLegacyDataOnce() {
      await this.init();
      const saved = await storage.getSavedState();
      const normalized = this._normalize(saved || emptyState());
      normalized.meta = { ...(normalized.meta || {}), migratedAt: nowISO() };
      normalized.meta.lastSavedAt = normalized.meta.lastSavedAt || nowISO();
      await storage.setSavedState(normalized);
      this._saved = deepClone(normalized);
      this._draft = deepClone(normalized);
      this._dirty = false;
      return this.getSaved({ scope: "all" });
    },

    isReady() { return this._ready; },

    // Read-only view
    getSaved({ scope = "active" } = {}) {
      if (scope === "all") {
        const hasSession = !!readSession();
        if (hasSession && getActiveRole() !== "platform_admin") {
          return this._viewState(this._scopedToActiveCompany(this._saved));
        }
        return this._viewState(this._saved);
      }
      return this._viewState(this._scopedToActiveCompany(this._saved));
    },
    getDraft({ scope = "active" } = {}) {
      if (scope === "all") {
        const hasSession = !!readSession();
        if (hasSession && getActiveRole() !== "platform_admin") {
          return this._viewState(this._scopedToActiveCompany(this._draft));
        }
        return this._viewState(this._draft);
      }
      return this._viewState(this._scopedToActiveCompany(this._draft));
    },

    isDirty() { return !!this._dirty; },

    markEdited() {
      this._dirty = true;
      this._draft.meta.lastEditedAt = nowISO();
    },

    async save() {
      // Commit draft -> saved -> storage
      const normalized = this._normalize(this._draft);
      normalized.meta.lastSavedAt = nowISO();

      await storage.setSavedState(normalized);
      this._saved = deepClone(normalized);
      this._draft = deepClone(normalized);
      this._dirty = false;

      return this.getSaved();
    },

    async resetDraftToSaved() {
      // Discard changes
      this._draft = deepClone(this._saved);
      this._dirty = false;
      return this.getDraft();
    },

    async wipeAll() {
      await storage.clear();
      const fresh = emptyState();
      this._saved = deepClone(fresh);
      this._draft = deepClone(fresh);
      this._dirty = false;
      return this.getSaved();
    },

    async wipeCompanyData({ companyCode = "", includeEmployeeUsers = true } = {}) {
      const cc = normalizeCompanyCode(companyCode || getActiveCompanyCode());
      if (!cc) throw new Error("Missing company code.");

      const keepUser = (u) => {
        if (normalizeCompanyCode(u.companyCode) !== cc) return true;
        if (!includeEmployeeUsers) return true;
        return String(u.role || "") !== "employee";
      };

      const next = deepClone(this._draft);
      next.employees = (next.employees || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
      next.locations = (next.locations || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
      next.job_types = (next.job_types || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
      next.crews = (next.crews || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
      next.crew_members = (next.crew_members || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
      next.shifts = (next.shifts || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
      next.shift_jobs = (next.shift_jobs || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
      next.requests = (next.requests || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
      next.users = (next.users || []).filter(keepUser);

      this._draft = next;
      this.markEdited();
      await this.save();
      return this.getSaved();
    },

    exportJSON() {
      // Export saved (authoritative)
      return JSON.stringify(this._saved, null, 2);
    },

    async importJSON(jsonText) {
      let obj;
      try { obj = JSON.parse(jsonText); }
      catch { throw new Error("Invalid JSON"); }

      const normalized = this._normalize(obj);
      normalized.meta.lastSavedAt = nowISO();

      await storage.setSavedState(normalized);
      this._saved = deepClone(normalized);
      this._draft = deepClone(normalized);
      this._dirty = false;
      return this.getSaved();
    },

    /** ---------------------------
     *  CRUD - Users (Access Control)
     *  ---------------------------
     *  Stored in the same local-first state, but separate from employees.
     *  Note: Changes require Save to take effect (unless a page calls save()).
     */
    addUser({ companyCode, username, pinHash, role, employeeId = null }) {
      const cc = String(companyCode || "").trim().toUpperCase();
      const un = normalizeUsername(username);
      const r = String(role || "").trim();
      const allowedRoles = new Set(["platform_admin", "manager", "employee"]);

      if (!cc) throw new Error("Company code is required.");
      if (!un) throw new Error("Username is required.");
      if (!allowedRoles.has(r)) throw new Error("Invalid role.");

      const actorRole = getActiveRole();
      const hasSession = !!readSession();
      if (!hasSession) {
        // Bootstrap: allow creating the platform admin before any session exists.
        if (!(cc === "PLATFORM" && r === "platform_admin")) {
          throw new Error("Not authorized.");
        }
      } else if (actorRole !== "platform_admin") {
        if (cc !== getActiveCompanyCode()) throw new Error("Not authorized.");
        if (cc === "PLATFORM") throw new Error("Not authorized.");
        if (r === "platform_admin") throw new Error("Not authorized.");
      }

      const ph = String(pinHash || "").trim();
      if (!ph) throw new Error("PIN hash is required.");

      const existing = (this._draft.users || []).find(u =>
        String(u.companyCode || "").trim().toUpperCase() === cc &&
        String(u.username || "").trim().toLowerCase() === un
      );
      if (existing) throw new Error("That username is already in use for this company.");

      const empId = employeeId ? String(employeeId) : null;
      if (r === "employee" && !empId) throw new Error("Employee accounts must be linked to an employee.");

      const u = {
        id: uid("usr"),
        companyCode: cc,
        username: un,
        pinHash: ph,
        role: r,
        employeeId: empId,
        active: true,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };

      this._draft.users = Array.isArray(this._draft.users) ? this._draft.users : [];
      this._draft.users.push(u);
      this.markEdited();
      return deepClone(u);
    },

    updateUser(userId, patch) {
      this._draft.users = Array.isArray(this._draft.users) ? this._draft.users : [];
      const u = this._draft.users.find(x => x.id === userId);
      if (!u) throw new Error("User not found.");
      if (getActiveRole() !== "platform_admin" && normalizeCompanyCode(u.companyCode) !== getActiveCompanyCode()) {
        throw new Error("User not found.");
      }

      if (patch.username !== undefined) {
        const cc = String(u.companyCode || "").trim().toUpperCase();
        const un = normalizeUsername(patch.username);
        if (!un) throw new Error("Username cannot be empty.");
        const dupe = this._draft.users.find(x =>
          x.id !== u.id &&
          String(x.companyCode || "").trim().toUpperCase() === cc &&
          String(x.username || "").trim().toLowerCase() === un
        );
        if (dupe) throw new Error("That username is already in use for this company.");
        u.username = un;
      }

      if (patch.pinHash !== undefined) {
        const ph = String(patch.pinHash || "").trim();
        if (!ph) throw new Error("PIN hash cannot be empty.");
        u.pinHash = ph;
        // Clear any legacy plain PIN field if present
        if (u.pin !== undefined) delete u.pin;
      }

      if (patch.role !== undefined) {
        const r = String(patch.role || "").trim();
        const allowedRoles = new Set(["platform_admin", "manager", "employee"]);
        if (!allowedRoles.has(r)) throw new Error("Invalid role.");
        u.role = r;
      }

      if (patch.employeeId !== undefined) {
        const empId = patch.employeeId ? String(patch.employeeId) : null;
        if (String(u.role || "") === "employee" && !empId) {
          throw new Error("Employee accounts must be linked to an employee.");
        }
        u.employeeId = empId;
      }

      if (patch.active !== undefined) u.active = !!patch.active;

      u.updatedAt = nowISO();
      this.markEdited();
      return deepClone(u);
    },

    /** ---------------------------
     *  Account Change Requests (Local-first workflow)
     *  ---------------------------
     */
    _assertRequestRole(type) {
      const role = getActiveRole();
      if (type === "manager_change_credentials" && role !== "manager") {
        throw new Error("Only managers can create this request.");
      }
      if (type === "employee_change_credentials" && role !== "employee") {
        throw new Error("Only employees can create this request.");
      }
      if (type === "admin_change_credentials" && role !== "platform_admin") {
        throw new Error("Only the platform admin can log this request.");
      }
      return role;
    },

    _getUserByIdOrThrow(userId) {
      this._draft.users = Array.isArray(this._draft.users) ? this._draft.users : [];
      const u = this._draft.users.find(x => String(x.id || "") === String(userId || ""));
      if (!u) throw new Error("User not found. Please sign in again.");
      return u;
    },

    _assertPin4(pin) {
      const pn = String(pin || "").trim();
      if (!/^[0-9]{4}$/.test(pn)) throw new Error("PIN must be exactly 4 digits.");
      return pn;
    },

    async _sha256Hex(text) {
      const enc = new TextEncoder();
      if (!globalThis.crypto?.subtle?.digest) return null;
      const buf = await globalThis.crypto.subtle.digest("SHA-256", enc.encode(String(text)));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    },

    async _hashPin({ companyCode, username, pin }) {
      const cc = normalizeCompanyCode(companyCode);
      const un = normalizeUsername(username);
      const pn = String(pin || "").trim();
      const pinHash = (await this._sha256Hex(`${cc}:${un}:${pn}`)) || `plain:${pn}`;
      return pinHash;
    },

    createRequest({ type, proposedUsername, proposedPin, note = "" } = {}) {
      const t = String(type || "").trim();
      const allowedTypes = new Set([
        "manager_change_credentials",
        "employee_change_credentials",
        "admin_change_credentials",
      ]);
      if (!allowedTypes.has(t)) throw new Error("Invalid request type.");

      const role = this._assertRequestRole(t);
      const sessionCompany = getActiveCompanyCode();
      const requesterUserId = getActiveUserId();
      if (!requesterUserId) throw new Error("Session is missing user ID. Please sign in again.");
      if (!sessionCompany) throw new Error("Missing company code in session. Please sign in again.");

      const requester = this._getUserByIdOrThrow(requesterUserId);
      if (normalizeCompanyCode(requester.companyCode) !== sessionCompany) {
        throw new Error("Company mismatch. Please sign in again.");
      }
      if (String(requester.role || "") !== role) {
        throw new Error("Role mismatch. Please sign in again.");
      }

      const targetUserId = requesterUserId; // self-service requests only

      const desiredUsernameRaw = String(proposedUsername || "").trim();
      const desiredUsername = desiredUsernameRaw ? normalizeUsername(desiredUsernameRaw) : "";
      const currentUsername = normalizeUsername(requester.username);

      const wantsUsername = !!desiredUsername && desiredUsername !== currentUsername;
      const wantsPin = String(proposedPin || "").trim().length > 0;

      if (!wantsUsername && !wantsPin) throw new Error("Enter a new username and/or a new PIN.");

      let cleanPin = "";
      if (wantsPin) cleanPin = this._assertPin4(proposedPin);
      if (wantsUsername && !wantsPin) {
        throw new Error("Changing the username requires setting a new PIN.");
      }

      // Pre-flight uniqueness check (within company)
      if (wantsUsername) {
        const dupe = (this._draft.users || []).find(u =>
          String(u.id || "") !== String(targetUserId) &&
          normalizeCompanyCode(u.companyCode) === sessionCompany &&
          normalizeUsername(u.username) === desiredUsername
        );
        if (dupe) throw new Error("That username is already in use for this company.");
      }

      const isAdminAudit = t === "admin_change_credentials";
      const createdAt = nowISO();

      const requestedNote = String(note || "").trim();
      const req = {
        id: uid("req"),
        companyCode: sessionCompany,
        type: t,
        status: isAdminAudit ? "approved" : "pending",
        requesterUserId,
        targetUserId,
        createdAt,
        proposedUsername: wantsUsername ? desiredUsername : "",
        proposedPin: wantsPin ? cleanPin : "",
        handledBy: isAdminAudit ? requesterUserId : "",
        handledAt: isAdminAudit ? createdAt : "",
        decisionNote: (() => {
          const base = requestedNote ? `Request: ${requestedNote}` : "";
          if (!isAdminAudit) return base;
          const adminAudit = "Decision: Self-managed admin credential change.";
          if (!base) return adminAudit;
          return `${base}\n\n${adminAudit}`;
        })(),
      };

      this._draft.requests = Array.isArray(this._draft.requests) ? this._draft.requests : [];
      this._draft.requests.push(req);
      this.markEdited();
      return deepClone(req);
    },

    listPendingRequestsForAdmin() {
      if (getActiveRole() !== "platform_admin") throw new Error("Not authorized.");
      const rows = Array.isArray(this._draft.requests) ? this._draft.requests : [];
      return deepClone(
        rows
          .filter(r => String(r.status || "") === "pending" && String(r.type || "") === "manager_change_credentials")
          .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
      );
    },

    listPendingManagerRequestsForAdmin() {
      return this.listPendingRequestsForAdmin();
    },

    listPendingEmployeeRequestsForManager(companyCode) {
      if (getActiveRole() !== "manager") throw new Error("Not authorized.");
      const cc = normalizeCompanyCode(companyCode || getActiveCompanyCode());
      if (!cc) throw new Error("Missing company code.");
      if (cc !== getActiveCompanyCode()) throw new Error("Not authorized.");
      const rows = Array.isArray(this._draft.requests) ? this._draft.requests : [];
      return deepClone(
        rows
          .filter(r =>
            String(r.status || "") === "pending" &&
            String(r.type || "") === "employee_change_credentials" &&
            normalizeCompanyCode(r.companyCode) === cc
          )
          .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
      );
    },

    async approveRequest(requestId, { decisionNote = "" } = {}) {
      const actorRole = getActiveRole();
      const actorUserId = getActiveUserId();
      if (!actorUserId) throw new Error("Session is missing user ID. Please sign in again.");

      this._draft.requests = Array.isArray(this._draft.requests) ? this._draft.requests : [];
      const req = this._draft.requests.find(r => String(r.id || "") === String(requestId || ""));
      if (!req) throw new Error("Request not found.");
      if (String(req.status || "") !== "pending") throw new Error("Request is not pending.");

      const type = String(req.type || "");
      const cc = normalizeCompanyCode(req.companyCode);
      if (!cc) throw new Error("Request company code is missing.");

      if (type === "manager_change_credentials") {
        if (actorRole !== "platform_admin") throw new Error("Not authorized.");
      } else if (type === "employee_change_credentials") {
        if (actorRole !== "manager") throw new Error("Not authorized.");
        if (cc !== getActiveCompanyCode()) throw new Error("Not authorized.");
      } else {
        throw new Error("Invalid request type.");
      }

      const target = this._getUserByIdOrThrow(req.targetUserId);
      if (normalizeCompanyCode(target.companyCode) !== cc) throw new Error("Target/company mismatch.");

      const desiredUsername = normalizeUsername(req.proposedUsername);
      const desiredPin = String(req.proposedPin || "").trim();

      const currentUsername = normalizeUsername(target.username);
      const wantsUsername = !!desiredUsername && desiredUsername !== currentUsername;
      const wantsPin = !!desiredPin;

      if (wantsUsername && !wantsPin) throw new Error("Changing the username requires setting a new PIN.");
      if (wantsPin) this._assertPin4(desiredPin);

      // Apply changes: username first (uniqueness enforced), then PIN hash using final username
      let finalUsername = currentUsername;
      if (wantsUsername) {
        this.updateUser(target.id, { username: desiredUsername });
        finalUsername = desiredUsername;
      }

      if (wantsPin) {
        const pinHash = await this._hashPin({ companyCode: cc, username: finalUsername, pin: desiredPin });
        this.updateUser(target.id, { pinHash, active: true });
      }

      req.status = "approved";
      req.handledBy = actorUserId;
      req.handledAt = nowISO();
      const dn = String(decisionNote || "").trim();
      if (dn) {
        req.decisionNote = req.decisionNote ? `${req.decisionNote}\n\nDecision: ${dn}` : `Decision: ${dn}`;
      }
      this.markEdited();
      return deepClone(req);
    },

    denyRequest(requestId, { decisionNote = "" } = {}) {
      const actorRole = getActiveRole();
      const actorUserId = getActiveUserId();
      if (!actorUserId) throw new Error("Session is missing user ID. Please sign in again.");

      this._draft.requests = Array.isArray(this._draft.requests) ? this._draft.requests : [];
      const req = this._draft.requests.find(r => String(r.id || "") === String(requestId || ""));
      if (!req) throw new Error("Request not found.");
      if (String(req.status || "") !== "pending") throw new Error("Request is not pending.");

      const type = String(req.type || "");
      const cc = normalizeCompanyCode(req.companyCode);

      if (type === "manager_change_credentials") {
        if (actorRole !== "platform_admin") throw new Error("Not authorized.");
      } else if (type === "employee_change_credentials") {
        if (actorRole !== "manager") throw new Error("Not authorized.");
        if (cc !== getActiveCompanyCode()) throw new Error("Not authorized.");
      } else {
        throw new Error("Invalid request type.");
      }

      req.status = "denied";
      req.handledBy = actorUserId;
      req.handledAt = nowISO();
      const dn = String(decisionNote || "").trim();
      if (dn) {
        req.decisionNote = req.decisionNote ? `${req.decisionNote}\n\nDecision: ${dn}` : `Decision: ${dn}`;
      }
      this.markEdited();
      return deepClone(req);
    },

    /** ---------------------------
     *  CRUD - Employees
     *  ---------------------------
     */
    addEmployee({ name, contact = "" }) {
      const cc = getActiveCompanyCode();
      if (!cc) throw new Error("Missing company code in session. Please sign in again.");
      name = (name || "").trim();
      contact = (contact || "").trim();
      if (!name) throw new Error("Employee name is required.");

      const e = {
        id: uid("emp"),
        companyCode: cc,
        name,
        contact,
        active: true,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      this._draft.employees.push(e);
      this.markEdited();
      return deepClone(e);
    },

    updateEmployee(empId, patch) {
      const e = this._draft.employees.find(x => x.id === empId);
      if (!e) throw new Error("Employee not found.");
      if (normalizeCompanyCode(e.companyCode) !== getActiveCompanyCode() && getActiveRole() !== "platform_admin") {
        throw new Error("Employee not found.");
      }

      if (patch.name !== undefined) {
        const n = String(patch.name).trim();
        if (!n) throw new Error("Employee name cannot be empty.");
        e.name = n;
      }
      if (patch.contact !== undefined) e.contact = String(patch.contact || "").trim();
      if (patch.active !== undefined) e.active = !!patch.active;

      e.updatedAt = nowISO();
      this.markEdited();
      return deepClone(e);
    },

    deleteEmployee(empId, { cascade = true } = {}) {
      const target = (this._draft.employees || []).find(x => x.id === empId);
      if (!target) throw new Error("Employee not found.");
      if (normalizeCompanyCode(target.companyCode) !== getActiveCompanyCode() && getActiveRole() !== "platform_admin") {
        throw new Error("Employee not found.");
      }
      this._draft.employees = (this._draft.employees || []).filter(x => x.id !== empId);

      if (cascade) {
        this._draft.crew_members = (this._draft.crew_members || []).filter(cm => String(cm.employeeId || "") !== String(empId));
        const deletedShiftIds = new Set((this._draft.shifts || []).filter(s => String(s.empId || "") === String(empId)).map(s => s.id));
        this._draft.shifts = (this._draft.shifts || []).filter(s => String(s.empId || "") !== String(empId));
        if (deletedShiftIds.size) {
          this._draft.shift_jobs = (this._draft.shift_jobs || []).filter(sj => !deletedShiftIds.has(String(sj.shiftId || "")));
        }
      }
      this.markEdited();
      return true;
    },

    /** ---------------------------
     *  CRUD - Locations
     *  ---------------------------
     */
    addLocation({ name, address = "" }) {
      const cc = getActiveCompanyCode();
      if (!cc) throw new Error("Missing company code in session. Please sign in again.");
      name = (name || "").trim();
      address = (address || "").trim();
      if (!name) throw new Error("Location name is required.");

      const l = {
        id: uid("loc"),
        companyCode: cc,
        name,
        address,
        active: true,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      this._draft.locations.push(l);
      this.markEdited();
      return deepClone(l);
    },

    updateLocation(locId, patch) {
      const l = this._draft.locations.find(x => x.id === locId);
      if (!l) throw new Error("Location not found.");
      if (normalizeCompanyCode(l.companyCode) !== getActiveCompanyCode() && getActiveRole() !== "platform_admin") {
        throw new Error("Location not found.");
      }

      if (patch.name !== undefined) {
        const n = String(patch.name).trim();
        if (!n) throw new Error("Location name cannot be empty.");
        l.name = n;
      }
      if (patch.address !== undefined) l.address = String(patch.address || "").trim();
      if (patch.active !== undefined) l.active = !!patch.active;

      l.updatedAt = nowISO();
      this.markEdited();
      return deepClone(l);
    },

    deleteLocation(locId, { cascade = true } = {}) {
      const target = (this._draft.locations || []).find(x => x.id === locId);
      if (!target) throw new Error("Location not found.");
      if (normalizeCompanyCode(target.companyCode) !== getActiveCompanyCode() && getActiveRole() !== "platform_admin") {
        throw new Error("Location not found.");
      }
      this._draft.locations = (this._draft.locations || []).filter(x => x.id !== locId);

      if (cascade) {
        this._draft.shifts = this._draft.shifts.filter(s => s.locId !== locId);
      }
      this.markEdited();
      return true;
    },

    /** ---------------------------
     *  CRUD - Job Types
     *  ---------------------------
     */
    addJobType({ name }) {
      const cc = getActiveCompanyCode();
      if (!cc) throw new Error("Missing company code in session. Please sign in again.");
      name = (name || "").trim();
      if (!name) throw new Error("Job type name is required.");

      const j = {
        id: uid("job"),
        companyCode: cc,
        name,
        active: true,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      this._draft.job_types.push(j);
      this.markEdited();
      return deepClone(j);
    },

    updateJobType(jobId, patch) {
      const j = this._draft.job_types.find(x => x.id === jobId);
      if (!j) throw new Error("Job type not found.");
      if (normalizeCompanyCode(j.companyCode) !== getActiveCompanyCode() && getActiveRole() !== "platform_admin") {
        throw new Error("Job type not found.");
      }

      if (patch.name !== undefined) {
        const n = String(patch.name).trim();
        if (!n) throw new Error("Job type name cannot be empty.");
        j.name = n;
      }
      if (patch.active !== undefined) j.active = !!patch.active;

      j.updatedAt = nowISO();
      this.markEdited();
      return deepClone(j);
    },

    deleteJobType(jobId) {
      const target = (this._draft.job_types || []).find(x => x.id === jobId);
      if (!target) throw new Error("Job type not found.");
      if (normalizeCompanyCode(target.companyCode) !== getActiveCompanyCode() && getActiveRole() !== "platform_admin") {
        throw new Error("Job type not found.");
      }
      this._draft.job_types = (this._draft.job_types || []).filter(x => x.id !== jobId);
      this._draft.shift_jobs = (this._draft.shift_jobs || []).filter(sj => String(sj.jobTypeId || "") !== String(jobId));
      this.markEdited();
      return true;
    },

    /** ---------------------------
     *  Settings
     *  ---------------------------
     */
    updateSettings(patch = {}) {
      const next = { ...(this._draft.settings || {}) };
      if (patch.companyName !== undefined) next.companyName = String(patch.companyName || "").trim();
      this._draft.settings = next;
      this.markEdited();
      return deepClone(this._draft.settings);
    },

    /** ---------------------------
     *  CRUD - Crews
     *  ---------------------------
     */
    addCrew({ name, active = true } = {}) {
      const cc = getActiveCompanyCode();
      if (!cc) throw new Error("Missing company code in session. Please sign in again.");
      name = String(name || "").trim();
      if (!name) throw new Error("Crew name is required.");

      const c = {
        id: uid("crew"),
        companyCode: cc,
        name,
        active: active !== undefined ? !!active : true,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      this._draft.crews.push(c);
      this.markEdited();
      return deepClone(c);
    },

    updateCrew(crewId, patch = {}) {
      const c = (this._draft.crews || []).find(x => x.id === crewId);
      if (!c) throw new Error("Crew not found.");
      if (normalizeCompanyCode(c.companyCode) !== getActiveCompanyCode() && getActiveRole() !== "platform_admin") {
        throw new Error("Crew not found.");
      }

      if (patch.name !== undefined) {
        const n = String(patch.name || "").trim();
        if (!n) throw new Error("Crew name cannot be empty.");
        c.name = n;
      }
      if (patch.active !== undefined) c.active = !!patch.active;

      c.updatedAt = nowISO();
      this.markEdited();
      return deepClone(c);
    },

    deleteCrew(crewId, { cascade = true } = {}) {
      const target = (this._draft.crews || []).find(x => x.id === crewId);
      if (!target) throw new Error("Crew not found.");
      if (normalizeCompanyCode(target.companyCode) !== getActiveCompanyCode() && getActiveRole() !== "platform_admin") {
        throw new Error("Crew not found.");
      }
      this._draft.crews = (this._draft.crews || []).filter(x => x.id !== crewId);

      if (cascade) {
        this._draft.crew_members = (this._draft.crew_members || []).filter(cm => String(cm.crewId || "") !== String(crewId));
        const deletedShiftIds = new Set((this._draft.shifts || []).filter(s => String(s.crewId || "") === String(crewId)).map(s => s.id));
        this._draft.shifts = (this._draft.shifts || []).filter(s => String(s.crewId || "") !== String(crewId));
        if (deletedShiftIds.size) {
          this._draft.shift_jobs = (this._draft.shift_jobs || []).filter(sj => !deletedShiftIds.has(String(sj.shiftId || "")));
        }
      }
      this.markEdited();
      return true;
    },

    addCrewMember({ crewId, employeeId, empId } = {}) {
      const cc = getActiveCompanyCode();
      if (!cc) throw new Error("Missing company code in session. Please sign in again.");
      crewId = String(crewId || "");
      const finalEmployeeId = String(employeeId || empId || "");
      if (!crewId) throw new Error("Crew is required.");
      if (!finalEmployeeId) throw new Error("Employee is required.");

      const crew = (this._draft.crews || []).find(c => c.id === crewId) || null;
      if (!crew || normalizeCompanyCode(crew.companyCode) !== cc) throw new Error("Crew not found.");
      const emp = (this._draft.employees || []).find(e => e.id === finalEmployeeId) || null;
      if (!emp || normalizeCompanyCode(emp.companyCode) !== cc) throw new Error("Employee not found.");

      const exists = (this._draft.crew_members || []).some(cm =>
        normalizeCompanyCode(cm.companyCode) === cc && String(cm.crewId || "") === crewId && String(cm.employeeId || "") === finalEmployeeId
      );
      if (exists) return false;

      const cm = {
        id: uid("crew_member"),
        companyCode: cc,
        crewId,
        employeeId: finalEmployeeId,
        createdAt: nowISO(),
      };
      this._draft.crew_members.push(cm);
      this.markEdited();
      return deepClone(cm);
    },

    removeCrewMember({ crewId, employeeId, empId } = {}) {
      const cc = getActiveCompanyCode();
      if (!cc) throw new Error("Missing company code in session. Please sign in again.");
      crewId = String(crewId || "");
      const finalEmployeeId = String(employeeId || empId || "");
      const before = (this._draft.crew_members || []).length;
      this._draft.crew_members = (this._draft.crew_members || []).filter(cm => {
        if (normalizeCompanyCode(cm.companyCode) !== cc) return true;
        return !(String(cm.crewId || "") === crewId && String(cm.employeeId || "") === finalEmployeeId);
      });
      if (this._draft.crew_members.length === before) throw new Error("Crew member not found.");
      this.markEdited();
      return true;
    },

    setEmployeeCrews(employeeId, crewIds = []) {
      const cc = getActiveCompanyCode();
      if (!cc) throw new Error("Missing company code in session. Please sign in again.");
      const empId = String(employeeId || "");
      if (!empId) throw new Error("Employee is required.");
      const emp = (this._draft.employees || []).find(e => String(e.id || "") === empId) || null;
      if (!emp || normalizeCompanyCode(emp.companyCode) !== cc) throw new Error("Employee not found.");

      const allowedCrewIds = new Set(
        (this._draft.crews || [])
          .filter(c => normalizeCompanyCode(c.companyCode) === cc)
          .map(c => String(c.id || ""))
      );
      const desired = Array.from(new Set((Array.isArray(crewIds) ? crewIds : []).map(String)))
        .filter(id => allowedCrewIds.has(id));

      this._draft.crew_members = Array.isArray(this._draft.crew_members) ? this._draft.crew_members : [];
      this._draft.crew_members = this._draft.crew_members.filter(cm =>
        normalizeCompanyCode(cm.companyCode) !== cc || String(cm.employeeId || "") !== empId
      );
      for (const crewId of desired) {
        this._draft.crew_members.push({
          id: uid("crew_member"),
          companyCode: cc,
          crewId: String(crewId),
          employeeId: empId,
          createdAt: nowISO(),
        });
      }
      this.markEdited();
      return true;
    },

    getCrewsForEmployee(employeeId, { state = null, includeInactive = true } = {}) {
      const s = state && typeof state === "object" ? state : this._draft;
      const empId = String(employeeId || "");
      if (!empId) return [];
      const crewIds = new Set(
        (Array.isArray(s.crew_members) ? s.crew_members : [])
          .filter(cm => String(cm.employeeId || "") === empId)
          .map(cm => String(cm.crewId || ""))
          .filter(Boolean)
      );
      let crews = (Array.isArray(s.crews) ? s.crews : []).filter(c => crewIds.has(String(c.id || "")));
      if (!includeInactive) crews = crews.filter(c => c.active !== false);
      crews = crews.slice().sort((a,b) => String(a.name || "").localeCompare(String(b.name || "")));
      return deepClone(crews);
    },

    /** ---------------------------
     *  CRUD - Shifts
     *  ---------------------------
     */
    addShift({ targetType, targetId, empId, crewId, locId, date, start, end, jobTypeIds = [], notes = "" }) {
      const cc = getActiveCompanyCode();
      if (!cc) throw new Error("Missing company code in session. Please sign in again.");
      targetType = String(targetType || "");
      targetId = String(targetId || "");
      empId = String(empId || "");
      crewId = String(crewId || "");
      locId = String(locId || "");
      date = String(date || "");
      start = String(start || "");
      end = String(end || "");
      notes = String(notes || "").trim();

      let finalEmpId = empId || null;
      let finalCrewId = crewId || null;

      if (!finalEmpId && !finalCrewId && targetType && targetId) {
        if (targetType === "employee") finalEmpId = targetId;
        if (targetType === "crew") finalCrewId = targetId;
      }

      if (!!finalEmpId === !!finalCrewId) throw new Error("Shift must be assigned to exactly one: employee or crew.");
      if (!locId) throw new Error("Location is required.");
      if (!date) throw new Error("Date is required.");
      if (!start) throw new Error("Start time is required.");
      if (!end) throw new Error("End time is required.");
      if (end <= start) throw new Error("End time must be after start time.");

      // Ensure emp/loc exist (in draft)
      if (finalEmpId) {
        const emp = (this._draft.employees || []).find(e => e.id === finalEmpId) || null;
        if (!emp || normalizeCompanyCode(emp.companyCode) !== cc) throw new Error("Employee not found.");
      }
      if (finalCrewId) {
        const crew = (this._draft.crews || []).find(c => c.id === finalCrewId) || null;
        if (!crew || normalizeCompanyCode(crew.companyCode) !== cc) throw new Error("Crew not found.");
      }
      const loc = (this._draft.locations || []).find(l => l.id === locId) || null;
      if (!loc || normalizeCompanyCode(loc.companyCode) !== cc) throw new Error("Location not found.");

      // Filter jobTypeIds to valid ids
      const validJobs = new Set((this._draft.job_types || []).filter(j => normalizeCompanyCode(j.companyCode) === cc).map(j => j.id));
      const jobs = Array.from(new Set((jobTypeIds || []).map(String))).filter(id => validJobs.has(id));

      const shiftId = uid("shift");
      const s = {
        id: shiftId,
        companyCode: cc,
        locId,
        date,
        start,
        end,
        notes,
        empId: finalEmpId ? String(finalEmpId) : null,
        crewId: finalCrewId ? String(finalCrewId) : null,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      this._draft.shifts.push(s);

      this._draft.shift_jobs = Array.isArray(this._draft.shift_jobs) ? this._draft.shift_jobs : [];
      for (const jobTypeId of jobs) {
        this._draft.shift_jobs.push({
          id: uid("shift_job"),
          companyCode: cc,
          shiftId,
          jobTypeId: String(jobTypeId),
          createdAt: nowISO(),
        });
      }

      this.markEdited();
      return deepClone({ ...s, jobTypeIds: jobs });
    },

    updateShift(shiftId, patch) {
      const s = this._draft.shifts.find(x => x.id === shiftId);
      if (!s) throw new Error("Shift not found.");
      if (normalizeCompanyCode(s.companyCode) !== getActiveCompanyCode() && getActiveRole() !== "platform_admin") {
        throw new Error("Shift not found.");
      }

      const next = { ...s, ...patch };

      // Validate
      const incomingEmpId = patch.empId !== undefined ? (patch.empId ? String(patch.empId) : null) : (next.empId ? String(next.empId) : null);
      const incomingCrewId = patch.crewId !== undefined ? (patch.crewId ? String(patch.crewId) : null) : (next.crewId ? String(next.crewId) : null);
      let finalEmpId = incomingEmpId;
      let finalCrewId = incomingCrewId;
      if ((patch.targetType !== undefined || patch.targetId !== undefined) && patch.targetType && patch.targetId) {
        if (String(patch.targetType) === "employee") { finalEmpId = String(patch.targetId); finalCrewId = null; }
        if (String(patch.targetType) === "crew") { finalCrewId = String(patch.targetId); finalEmpId = null; }
      }
      if (!!finalEmpId === !!finalCrewId) throw new Error("Shift must be assigned to exactly one: employee or crew.");
      if (!next.locId) throw new Error("Location is required.");
      if (!next.date) throw new Error("Date is required.");
      if (!next.start) throw new Error("Start time is required.");
      if (!next.end) throw new Error("End time is required.");
      if (String(next.end) <= String(next.start)) throw new Error("End time must be after start time.");

      if (finalEmpId) {
        const emp = (this._draft.employees || []).find(e => e.id === finalEmpId) || null;
        if (!emp || normalizeCompanyCode(emp.companyCode) !== normalizeCompanyCode(s.companyCode)) throw new Error("Employee not found.");
      }
      if (finalCrewId) {
        const crew = (this._draft.crews || []).find(c => c.id === finalCrewId) || null;
        if (!crew || normalizeCompanyCode(crew.companyCode) !== normalizeCompanyCode(s.companyCode)) throw new Error("Crew not found.");
      }
      const loc = (this._draft.locations || []).find(l => l.id === next.locId) || null;
      if (!loc || normalizeCompanyCode(loc.companyCode) !== normalizeCompanyCode(s.companyCode)) throw new Error("Location not found.");

      let nextJobTypeIds = null;
      if (patch.jobTypeIds !== undefined) {
        const validJobs = new Set((this._draft.job_types || []).filter(j => normalizeCompanyCode(j.companyCode) === normalizeCompanyCode(s.companyCode)).map(j => j.id));
        nextJobTypeIds = Array.from(new Set((patch.jobTypeIds || []).map(String))).filter(id => validJobs.has(id));
      }

      next.notes = String(next.notes || "").trim();
      next.updatedAt = nowISO();
      next.empId = finalEmpId;
      next.crewId = finalCrewId;

      Object.assign(s, next);

      if (nextJobTypeIds !== null) {
        const cc = normalizeCompanyCode(s.companyCode);
        this._draft.shift_jobs = Array.isArray(this._draft.shift_jobs) ? this._draft.shift_jobs : [];
        this._draft.shift_jobs = this._draft.shift_jobs.filter(sj => String(sj.shiftId || "") !== String(shiftId));
        for (const jobTypeId of nextJobTypeIds) {
          this._draft.shift_jobs.push({
            id: uid("shift_job"),
            companyCode: cc,
            shiftId: String(shiftId),
            jobTypeId: String(jobTypeId),
            createdAt: nowISO(),
          });
        }
      }

      this.markEdited();
      const jobTypeIds = Array.isArray(this._draft.shift_jobs)
        ? this._draft.shift_jobs.filter(sj => String(sj.shiftId || "") === String(shiftId)).map(sj => String(sj.jobTypeId || "")).filter(Boolean)
        : [];
      return deepClone({ ...s, jobTypeIds });
    },

    deleteShift(shiftId) {
      const target = (this._draft.shifts || []).find(x => x.id === shiftId);
      if (!target) throw new Error("Shift not found.");
      if (normalizeCompanyCode(target.companyCode) !== getActiveCompanyCode() && getActiveRole() !== "platform_admin") {
        throw new Error("Shift not found.");
      }
      this._draft.shifts = (this._draft.shifts || []).filter(x => x.id !== shiftId);
      this._draft.shift_jobs = (this._draft.shift_jobs || []).filter(sj => String(sj.shiftId || "") !== String(shiftId));
      this.markEdited();
      return true;
    },

    /** ---------------------------
     *  Companies (platform admin)
     *  ---------------------------
     */
    addCompany({ companyCode, companyName } = {}) {
      if (getActiveRole() !== "platform_admin") throw new Error("Not authorized.");
      const cc = normalizeCompanyCode(companyCode);
      const name = String(companyName || "").trim();
      if (!cc) throw new Error("Company code is required.");
      if (!/^[A-Z0-9]{3,10}$/.test(cc)) throw new Error("Company code must be 3–10 characters (A–Z, 0–9).");
      if (!name) throw new Error("Company name is required.");

      this._draft.companies = Array.isArray(this._draft.companies) ? this._draft.companies : [];
      const exists = this._draft.companies.some(c => normalizeCompanyCode(c.companyCode) === cc);
      if (exists) throw new Error("That company code already exists.");

      const c = {
        id: uid("co"),
        companyCode: cc,
        companyName: name,
        isDisabled: false,
        supportEnabled: false,
        createdAt: nowISO(),
      };
      this._draft.companies.push(c);
      this.markEdited();
      return deepClone(c);
    },

    updateCompany(companyIdOrCode, patch = {}) {
      if (getActiveRole() !== "platform_admin") throw new Error("Not authorized.");
      this._draft.companies = Array.isArray(this._draft.companies) ? this._draft.companies : [];
      const key = String(companyIdOrCode || "").trim();
      if (!key) throw new Error("Company is required.");

      const match = this._draft.companies.find(c => c.id === key || normalizeCompanyCode(c.companyCode) === normalizeCompanyCode(key));
      if (!match) throw new Error("Company not found.");

      if (patch.companyName !== undefined) {
        const name = String(patch.companyName || "").trim();
        if (!name) throw new Error("Company name cannot be empty.");
        match.companyName = name;
      }
      if (patch.isDisabled !== undefined) match.isDisabled = !!patch.isDisabled;
      if (patch.supportEnabled !== undefined) match.supportEnabled = !!patch.supportEnabled;
      this.markEdited();
      return deepClone(match);
    },

    deleteCompany(companyIdOrCode, { deleteData = true, deleteUsers = true } = {}) {
      if (getActiveRole() !== "platform_admin") throw new Error("Not authorized.");
      this._draft.companies = Array.isArray(this._draft.companies) ? this._draft.companies : [];
      const key = String(companyIdOrCode || "").trim();
      if (!key) throw new Error("Company is required.");

      const match = this._draft.companies.find(c => c.id === key || normalizeCompanyCode(c.companyCode) === normalizeCompanyCode(key));
      if (!match) throw new Error("Company not found.");
      const cc = normalizeCompanyCode(match.companyCode);
      if (!cc) throw new Error("Company code is missing.");
      if (cc === "PLATFORM") throw new Error("Platform company cannot be deleted.");

      this._draft.companies = this._draft.companies.filter(c => c.id !== match.id);

      if (deleteData) {
        this._draft.employees = (this._draft.employees || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
        this._draft.locations = (this._draft.locations || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
        this._draft.job_types = (this._draft.job_types || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
        this._draft.crews = (this._draft.crews || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
        this._draft.crew_members = (this._draft.crew_members || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
        this._draft.shifts = (this._draft.shifts || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
        this._draft.shift_jobs = (this._draft.shift_jobs || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
      }

      if (deleteUsers) {
        this._draft.users = (this._draft.users || []).filter(u => normalizeCompanyCode(u.companyCode) !== cc);
      }

      this.markEdited();
      return true;
    },

    /** ---------------------------
     *  Helpers
     *  ---------------------------
     */
    listEmployees({ activeOnly = true } = {}) {
      const cc = getActiveCompanyCode();
      const rows = (this._draft.employees || []).filter(e => normalizeCompanyCode(e.companyCode) === cc);
      return deepClone(rows.filter(e => activeOnly ? e.active : true));
    },
    listLocations({ activeOnly = true } = {}) {
      const cc = getActiveCompanyCode();
      const rows = (this._draft.locations || []).filter(l => normalizeCompanyCode(l.companyCode) === cc);
      return deepClone(rows.filter(l => activeOnly ? l.active : true));
    },
    listJobTypes({ activeOnly = true } = {}) {
      const cc = getActiveCompanyCode();
      const rows = (this._draft.job_types || []).filter(j => normalizeCompanyCode(j.companyCode) === cc);
      return deepClone(rows.filter(j => activeOnly ? j.active : true));
    },
    listCrews({ activeOnly = true } = {}) {
      const cc = getActiveCompanyCode();
      const rows = (this._draft.crews || []).filter(c => normalizeCompanyCode(c.companyCode) === cc);
      return deepClone(rows.filter(c => activeOnly ? c.active : true));
    },
    listCrewMembers() {
      const cc = getActiveCompanyCode();
      return deepClone((this._draft.crew_members || []).filter(cm => normalizeCompanyCode(cm.companyCode) === cc));
    },
    listShifts() {
      const cc = getActiveCompanyCode();
      const shifts = (this._draft.shifts || []).filter(sh => normalizeCompanyCode(sh.companyCode) === cc);
      const jobTypeIdsByShiftId = {};
      for (const sj of (this._draft.shift_jobs || [])) {
        if (normalizeCompanyCode(sj.companyCode) !== cc) continue;
        const sid = String(sj.shiftId || "");
        const jid = String(sj.jobTypeId || "");
        if (!sid || !jid) continue;
        if (!jobTypeIdsByShiftId[sid]) jobTypeIdsByShiftId[sid] = new Set();
        jobTypeIdsByShiftId[sid].add(jid);
      }
      return deepClone(shifts.map(sh => ({
        ...sh,
        jobTypeIds: Array.from(jobTypeIdsByShiftId[String(sh.id || "")] || []),
        targetType: sh.empId ? "employee" : "crew",
        targetId: sh.empId ? sh.empId : sh.crewId,
      })));
    },

    _viewState(stateObj) {
      const s = deepClone(stateObj && typeof stateObj === "object" ? stateObj : emptyState());
      // Back-compat aliases (read-only snapshots; source of truth remains the *_tables keys)
      if (!("jobTypes" in s)) s.jobTypes = Array.isArray(s.job_types) ? s.job_types : [];
      if (!("crewMembers" in s)) {
        s.crewMembers = (Array.isArray(s.crew_members) ? s.crew_members : []).map(cm => ({
          ...cm,
          empId: cm.employeeId,
        }));
      }
      if (!("shiftJobs" in s)) s.shiftJobs = Array.isArray(s.shift_jobs) ? s.shift_jobs : [];

      const jobTypeIdsByShiftId = {};
      for (const sj of (s.shift_jobs || [])) {
        const sid = String(sj.shiftId || "");
        const jid = String(sj.jobTypeId || "");
        if (!sid || !jid) continue;
        if (!jobTypeIdsByShiftId[sid]) jobTypeIdsByShiftId[sid] = new Set();
        jobTypeIdsByShiftId[sid].add(jid);
      }
      s.shifts = (Array.isArray(s.shifts) ? s.shifts : []).map(sh => ({
        ...sh,
        jobTypeIds: Array.from(jobTypeIdsByShiftId[String(sh.id || "")] || []),
        targetType: sh.empId ? "employee" : "crew",
        targetId: sh.empId ? sh.empId : sh.crewId,
      }));

      s.requests = (Array.isArray(s.requests) ? s.requests : []).map(r => ({
        ...r,
        // Back-compat: older UI surfaces requester notes via `r.note`
        note: r.decisionNote || "",
        handledByUserId: r.handledBy || "",
      }));

      return s;
    },

    /** ---------------------------
     *  Reporting helpers (pure)
     *  - Accept an optional explicit state, otherwise use current draft.
     *  ---------------------------
     */
    formatWeekRange(weekStartYMD) {
      const startDt = parseYMD(weekStartYMD);
      if (!startDt) return "";
      const endDt = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate() + 6);
      return `${toYMD(startDt)} to ${toYMD(endDt)}`;
    },

    getAllCrewsWithMembers({ state = null, includeInactiveCrews = true, includeInactiveEmployees = true } = {}) {
      const s = state && typeof state === "object" ? state : this._draft;
      const crewsRaw = Array.isArray(s.crews) ? s.crews : [];
      const employeesRaw = Array.isArray(s.employees) ? s.employees : [];
      const crewMembersRaw = Array.isArray(s.crew_members) ? s.crew_members : [];

      const crews = includeInactiveCrews ? crewsRaw.slice() : crewsRaw.filter(c => c.active !== false);
      crews.sort((a,b) => String(a.name || "").localeCompare(String(b.name || "")));

      const empById = Object.fromEntries(employeesRaw.map(e => [e.id, e]));
      const empIdsByCrewId = {};
      for (const cm of crewMembersRaw) {
        const crewId = String(cm.crewId || "");
        const employeeId = String(cm.employeeId || "");
        if (!crewId || !employeeId) continue;
        if (!empIdsByCrewId[crewId]) empIdsByCrewId[crewId] = new Set();
        empIdsByCrewId[crewId].add(employeeId);
      }

      return crews.map(c => {
        const memberIds = Array.from(empIdsByCrewId[c.id] || []);
        const members = memberIds
          .map(id => empById[id])
          .filter(Boolean)
          .filter(e => includeInactiveEmployees ? true : e.active !== false)
          .slice()
          .sort((a,b) => String(a.name || "").localeCompare(String(b.name || "")));

        return {
          crew: deepClone(c),
          members: deepClone(members),
        };
      });
    },

    getCrewShiftsForPeriod(crewId, { state = null, mode, date, weekStart } = {}) {
      const s = state && typeof state === "object" ? state : this._draft;
      const shifts = Array.isArray(s.shifts) ? s.shifts : [];

      crewId = String(crewId || "");
      mode = String(mode || "").toLowerCase();
      date = String(date || "");
      weekStart = String(weekStart || "");
      if (!crewId) return [];

      if (mode === "daily") {
        if (!parseYMD(date)) return [];
        return deepClone(
          shifts
            .filter(sh => {
              return String(sh.crewId || "") === crewId && String(sh.date || "") === date;
            })
            .sort((a,b) => String(a.date + a.start).localeCompare(String(b.date + b.start)))
        );
      }

      if (mode === "weekly") {
        const startDt = parseYMD(weekStart);
        if (!startDt) return [];
        const ymdSet = new Set();
        for (let i = 0; i < 7; i++) {
          const d = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate() + i);
          ymdSet.add(toYMD(d));
        }

        return deepClone(
          shifts
            .filter(sh => {
              return String(sh.crewId || "") === crewId && ymdSet.has(String(sh.date || ""));
            })
            .sort((a,b) => String(a.date + a.start).localeCompare(String(b.date + b.start)))
        );
      }

      return [];
    },

    listShiftsForPeriod({ state = null, mode, date, weekStart, empId, crewId, includeCrewIds = [] } = {}) {
      const s = state && typeof state === "object" ? state : this._draft;
      mode = String(mode || "").toLowerCase();
      date = String(date || "");
      weekStart = String(weekStart || "");
      empId = empId ? String(empId) : "";
      crewId = crewId ? String(crewId) : "";
      const includeCrewSet = new Set((Array.isArray(includeCrewIds) ? includeCrewIds : []).map(String).filter(Boolean));

      const jobTypeIdsByShiftId = {};
      for (const sj of (Array.isArray(s.shift_jobs) ? s.shift_jobs : [])) {
        const sid = String(sj.shiftId || "");
        const jid = String(sj.jobTypeId || "");
        if (!sid || !jid) continue;
        if (!jobTypeIdsByShiftId[sid]) jobTypeIdsByShiftId[sid] = new Set();
        jobTypeIdsByShiftId[sid].add(jid);
      }

      let ymdSet = null;
      if (mode === "daily") {
        if (!parseYMD(date)) return [];
        ymdSet = new Set([date]);
      } else if (mode === "weekly") {
        const startDt = parseYMD(weekStart);
        if (!startDt) return [];
        ymdSet = new Set();
        for (let i = 0; i < 7; i++) {
          const d = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate() + i);
          ymdSet.add(toYMD(d));
        }
      }

      let shifts = Array.isArray(s.shifts) ? s.shifts : [];
      if (ymdSet) shifts = shifts.filter(sh => ymdSet.has(String(sh.date || "")));

      if (crewId) shifts = shifts.filter(sh => String(sh.crewId || "") === crewId);
      if (empId) {
        shifts = shifts.filter(sh => {
          if (String(sh.empId || "") === empId) return true;
          const cid = String(sh.crewId || "");
          return !!cid && includeCrewSet.has(cid);
        });
      }

      return deepClone(
        shifts
          .map(sh => ({
            ...sh,
            jobTypeIds: Array.from(jobTypeIdsByShiftId[String(sh.id || "")] || []),
            targetType: sh.empId ? "employee" : "crew",
            targetId: sh.empId ? sh.empId : sh.crewId,
          }))
          .sort((a,b) => String(a.date + a.start).localeCompare(String(b.date + b.start)))
      );
    },

    getEmployeeScheduleData(employeeId, { state = null, mode, date, weekStart } = {}) {
      const s = state && typeof state === "object" ? state : this._saved;
      const empId = String(employeeId || "");
      if (!empId) throw new Error("Employee is required.");
      const employee = (Array.isArray(s.employees) ? s.employees : []).find(e => String(e.id || "") === empId) || null;
      if (!employee) throw new Error("Employee not found.");

      const companyCode = normalizeCompanyCode(employee.companyCode);
      const company = (Array.isArray(s.companies) ? s.companies : []).find(c => normalizeCompanyCode(c.companyCode) === companyCode) || null;

      const crewIds = new Set(
        (Array.isArray(s.crew_members) ? s.crew_members : [])
          .filter(cm => normalizeCompanyCode(cm.companyCode) === companyCode && String(cm.employeeId || "") === empId)
          .map(cm => String(cm.crewId || ""))
          .filter(Boolean)
      );

      const shifts = this.listShiftsForPeriod({
        state: s,
        mode,
        date,
        weekStart,
        empId,
        includeCrewIds: Array.from(crewIds),
      });

      const locations = (Array.isArray(s.locations) ? s.locations : []).filter(l => normalizeCompanyCode(l.companyCode) === companyCode);
      const job_types = (Array.isArray(s.job_types) ? s.job_types : []).filter(j => normalizeCompanyCode(j.companyCode) === companyCode);
      const crews = (Array.isArray(s.crews) ? s.crews : []).filter(c => normalizeCompanyCode(c.companyCode) === companyCode && crewIds.has(String(c.id || "")));

      return deepClone({
        companyCode,
        company,
        employee,
        crews,
        shifts,
        locations,
        job_types,
      });
    },

    getAllCrewsScheduleData(mode, dateOrWeekStart, { state = null } = {}) {
      const s = state && typeof state === "object" ? state : this._saved;
      const m = String(mode || "").toLowerCase();
      const date = m === "daily" ? String(dateOrWeekStart || "") : "";
      const weekStart = m === "weekly" ? String(dateOrWeekStart || "") : "";

      const crewsWithMembers = this.getAllCrewsWithMembers({ state: s, includeInactiveCrews: true, includeInactiveEmployees: true });
      const locations = Array.isArray(s.locations) ? s.locations : [];
      const job_types = Array.isArray(s.job_types) ? s.job_types : [];

      const byCrewId = crewsWithMembers.map(({ crew, members }) => {
        const shifts = this.getCrewShiftsForPeriod(crew.id, { state: s, mode: m, date, weekStart });
        const shiftsWithJobs = this.listShiftsForPeriod({
          state: s,
          mode: m,
          date,
          weekStart,
          crewId: crew.id,
        });
        return { crew, members, shifts: shiftsWithJobs.length ? shiftsWithJobs : shifts };
      });

      return deepClone({
        mode: m,
        date,
        weekStart,
        crews: byCrewId,
        locations,
        job_types,
      });
    },

    _scopedToActiveCompany(stateObj) {
      const s = stateObj && typeof stateObj === "object" ? stateObj : emptyState();
      const cc = getActiveCompanyCode();
      if (!cc) {
        return {
          ...s,
          companies: [],
          users: [],
          requests: [],
          employees: [],
          locations: [],
          job_types: [],
          crews: [],
          crew_members: [],
          shifts: [],
          shift_jobs: [],
        };
      }

      const pick = (arr) =>
        (Array.isArray(arr) ? arr : []).filter(x => normalizeCompanyCode(x.companyCode) === cc);

      return {
        ...s,
        companies: pick(s.companies),
        users: pick(s.users),
        requests: pick(s.requests),
        employees: pick(s.employees),
        locations: pick(s.locations),
        job_types: pick(s.job_types),
        crews: pick(s.crews),
        crew_members: pick(s.crew_members),
        shifts: pick(s.shifts),
        shift_jobs: pick(s.shift_jobs),
      };
    },

    _normalize(stateObj) {
      const s = stateObj && typeof stateObj === "object" ? stateObj : emptyState();
      const out = emptyState();

      const str = (v) => String(v ?? "");
      const trim = (v) => str(v).trim();
      const ensureId = (v) => (trim(v) ? trim(v) : newId());
      const ensureCreatedAt = (v) => (trim(v) ? trim(v) : nowISO());
      const ensureUpdatedAt = (v) => (trim(v) ? trim(v) : nowISO());
      const boolActive = (v) => (v === undefined ? true : !!v);

      out.meta = { ...out.meta, ...(s.meta || {}) };
      out.meta.version = 4;

      out.settings = { ...(out.settings || {}), ...(s.settings || {}) };
      out.settings.companyName = trim(out.settings.companyName);

      out.companies = Array.isArray(s.companies) ? s.companies : [];
      out.users = Array.isArray(s.users) ? s.users : [];
      out.requests = Array.isArray(s.requests) ? s.requests : [];
      out.employees = Array.isArray(s.employees) ? s.employees : [];
      out.locations = Array.isArray(s.locations) ? s.locations : [];
      out.job_types = Array.isArray(s.job_types) ? s.job_types : (Array.isArray(s.jobTypes) ? s.jobTypes : []);
      out.crews = Array.isArray(s.crews) ? s.crews : [];
      out.crew_members = Array.isArray(s.crew_members) ? s.crew_members : (Array.isArray(s.crewMembers) ? s.crewMembers : []);
      out.shifts = Array.isArray(s.shifts) ? s.shifts : [];
      out.shift_jobs = Array.isArray(s.shift_jobs) ? s.shift_jobs : [];

      out.companies = out.companies
        .map(c => ({
          id: ensureId(c?.id),
          companyCode: normalizeCompanyCode(c?.companyCode),
          companyName: trim(c?.companyName),
          isDisabled: c?.isDisabled !== undefined ? !!c.isDisabled : false,
          supportEnabled: c?.supportEnabled !== undefined ? !!c.supportEnabled : false,
          createdAt: ensureCreatedAt(c?.createdAt),
        }))
        .filter(c => c.companyCode && c.companyName);

      const allowedRoles = new Set(["platform_admin", "manager", "employee"]);
      out.users = out.users
        .map(u => ({
          id: ensureId(u?.id),
          companyCode: normalizeCompanyCode(u?.companyCode),
          username: normalizeUsername(u?.username),
          pinHash: trim(u?.pinHash || u?.pin),
          role: allowedRoles.has(str(u?.role)) ? str(u.role) : "employee",
          employeeId: u?.employeeId ? str(u.employeeId) : null,
          active: u?.active !== undefined ? !!u.active : true,
          createdAt: ensureCreatedAt(u?.createdAt),
          updatedAt: ensureUpdatedAt(u?.updatedAt),
        }))
        .filter(u => u.companyCode && u.username && u.pinHash);

      const allowedRequestStatuses = new Set(["pending", "approved", "denied"]);
      const allowedRequestTypes = new Set([
        "manager_change_credentials",
        "employee_change_credentials",
        "admin_change_credentials",
      ]);
      out.requests = out.requests
        .map(r => {
          const companyCode = normalizeCompanyCode(r?.companyCode);
          const status = allowedRequestStatuses.has(str(r?.status)) ? str(r.status) : "pending";
          const type = allowedRequestTypes.has(str(r?.type)) ? str(r.type) : "";
          const proposedUsername = normalizeUsername(r?.proposedUsername || "");
          const proposedPin = trim(r?.proposedPin || "");
          return {
            id: ensureId(r?.id),
            companyCode,
            type,
            status,
            requesterUserId: trim(r?.requesterUserId),
            targetUserId: trim(r?.targetUserId),
            proposedUsername,
            proposedPin: /^[0-9]{4}$/.test(proposedPin) ? proposedPin : "",
            createdAt: ensureCreatedAt(r?.createdAt),
            handledAt: trim(r?.handledAt),
            handledBy: trim(r?.handledBy || r?.handledByUserId),
            decisionNote: trim(r?.decisionNote || r?.note || r?.reason || ""),
          };
        })
        .filter(r => r.id && r.companyCode && r.type && r.requesterUserId && r.targetUserId);

      const nonPlatformCompanyCodes = (() => {
        const fromCompanies = (out.companies || []).map(c => normalizeCompanyCode(c.companyCode)).filter(Boolean);
        const fromUsers = (out.users || [])
          .map(u => normalizeCompanyCode(u.companyCode))
          .filter(cc => cc && cc !== "PLATFORM");
        return Array.from(new Set([...fromCompanies, ...fromUsers])).filter(cc => cc && cc !== "PLATFORM");
      })();

      const defaultCompanyCode = nonPlatformCompanyCodes.length === 1 ? nonPlatformCompanyCodes[0] : "";

      // Migration: infer company records from existing users.
      for (const cc of nonPlatformCompanyCodes) {
        const has = (out.companies || []).some(c => normalizeCompanyCode(c.companyCode) === cc);
        if (has) continue;
        const nameFallback = nonPlatformCompanyCodes.length === 1
          ? (trim(out.settings?.companyName) || cc)
          : cc;
        out.companies.push({
          id: newId(),
          companyCode: cc,
          companyName: nameFallback,
          isDisabled: false,
          supportEnabled: false,
          createdAt: nowISO(),
        });
      }

      const normalizeNamedRecord = (row, { companyCode, nameKey, extra = {} } = {}) => {
        const cc = normalizeCompanyCode(row?.companyCode || companyCode);
        if (!cc) return null;
        const name = trim(row?.[nameKey]);
        if (!name) return null;
        return {
          id: ensureId(row?.id),
          companyCode: cc,
          ...extra,
          [nameKey]: name,
          active: row?.active !== undefined ? !!row.active : true,
          createdAt: ensureCreatedAt(row?.createdAt),
          updatedAt: ensureUpdatedAt(row?.updatedAt),
        };
      };

      out.employees = out.employees
        .map(e => normalizeNamedRecord(e, { companyCode: defaultCompanyCode, nameKey: "name", extra: { contact: str(e?.contact || "") } }))
        .filter(Boolean);

      out.locations = out.locations
        .map(l => normalizeNamedRecord(l, { companyCode: defaultCompanyCode, nameKey: "name", extra: { address: str(l?.address || "") } }))
        .filter(Boolean);

      out.job_types = out.job_types
        .map(j => normalizeNamedRecord(j, { companyCode: defaultCompanyCode, nameKey: "name" }))
        .filter(Boolean);

      out.crews = out.crews
        .map(c => normalizeNamedRecord(c, { companyCode: defaultCompanyCode, nameKey: "name" }))
        .filter(Boolean);

      const crewById = Object.fromEntries(out.crews.map(c => [c.id, c]));
      const empById = Object.fromEntries(out.employees.map(e => [e.id, e]));
      const locById = Object.fromEntries(out.locations.map(l => [l.id, l]));
      const jobById = Object.fromEntries(out.job_types.map(j => [j.id, j]));

      // Ensure employee accounts reference valid employees (or allow null for defensive compatibility)
      out.users = out.users.map(u => {
        if (str(u.role) === "employee") {
          const emp = u.employeeId ? empById[u.employeeId] : null;
          if (u.employeeId && !emp) u.employeeId = null;
          if (emp && normalizeCompanyCode(emp.companyCode) !== normalizeCompanyCode(u.companyCode)) u.employeeId = null;
        } else {
          u.employeeId = null;
        }
        return u;
      });

      const normalizeCrewMember = (cm) => {
        const companyCode = normalizeCompanyCode(cm?.companyCode || defaultCompanyCode);
        const crewId = trim(cm?.crewId);
        const employeeId = trim(cm?.employeeId || cm?.empId);
        if (!companyCode || !crewId || !employeeId) return null;
        const crew = crewById[crewId];
        const emp = empById[employeeId];
        if (!crew || !emp) return null;
        const cc = normalizeCompanyCode(companyCode);
        if (normalizeCompanyCode(crew.companyCode) !== cc) return null;
        if (normalizeCompanyCode(emp.companyCode) !== cc) return null;
        return {
          id: ensureId(cm?.id),
          companyCode: cc,
          crewId,
          employeeId,
          createdAt: ensureCreatedAt(cm?.createdAt),
        };
      };

      out.crew_members = out.crew_members.map(normalizeCrewMember).filter(Boolean);

      const normalizeShift = (sh) => {
        let empId = sh?.empId ? trim(sh.empId) : "";
        let crewId = sh?.crewId ? trim(sh.crewId) : "";

        if (!empId && !crewId && sh?.targetType && sh?.targetId) {
          const tt = str(sh.targetType);
          const tid = trim(sh.targetId);
          if (tt === "employee") empId = tid;
          if (tt === "crew") crewId = tid;
        }

        if (!!empId === !!crewId) return null;

        const locId = trim(sh?.locId);
        const date = trim(sh?.date);
        const start = trim(sh?.start);
        const end = trim(sh?.end);
        if (!locId || !date || !start || !end) return null;
        if (end <= start) return null;

        // Determine companyCode, then validate references against it.
        let companyCode = normalizeCompanyCode(sh?.companyCode || defaultCompanyCode);
        if (!companyCode) {
          if (empId && empById[empId]) companyCode = normalizeCompanyCode(empById[empId].companyCode);
          else if (crewId && crewById[crewId]) companyCode = normalizeCompanyCode(crewById[crewId].companyCode);
        }
        if (!companyCode) return null;

        const loc = locById[locId];
        if (!loc || normalizeCompanyCode(loc.companyCode) !== companyCode) return null;
        if (empId) {
          const emp = empById[empId];
          if (!emp || normalizeCompanyCode(emp.companyCode) !== companyCode) return null;
        }
        if (crewId) {
          const crew = crewById[crewId];
          if (!crew || normalizeCompanyCode(crew.companyCode) !== companyCode) return null;
        }

        return {
          id: ensureId(sh?.id),
          companyCode,
          date,
          start,
          end,
          notes: trim(sh?.notes),
          locId,
          empId: empId || null,
          crewId: crewId || null,
          createdAt: ensureCreatedAt(sh?.createdAt),
          updatedAt: ensureUpdatedAt(sh?.updatedAt),
        };
      };

      out.shifts = out.shifts.map(normalizeShift).filter(Boolean);
      const shiftById = Object.fromEntries(out.shifts.map(sh => [sh.id, sh]));

      const shiftJobsFromLegacyShifts = [];
      for (const sh of Array.isArray(s.shifts) ? s.shifts : []) {
        const sid = trim(sh?.id);
        if (!sid) continue;
        const jobTypeIds = Array.isArray(sh?.jobTypeIds) ? sh.jobTypeIds.map(trim).filter(Boolean) : [];
        for (const jobTypeId of jobTypeIds) {
          shiftJobsFromLegacyShifts.push({ shiftId: sid, jobTypeId, companyCode: sh?.companyCode, createdAt: sh?.createdAt });
        }
      }

      const rawShiftJobs = [
        ...(Array.isArray(out.shift_jobs) ? out.shift_jobs : []),
        ...shiftJobsFromLegacyShifts,
      ];

      const seen = new Set();
      out.shift_jobs = rawShiftJobs
        .map(sj => {
          const shiftId = trim(sj?.shiftId);
          const jobTypeId = trim(sj?.jobTypeId);
          if (!shiftId || !jobTypeId) return null;
          const shift = shiftById[shiftId];
          const job = jobById[jobTypeId];
          if (!shift || !job) return null;
          const cc = normalizeCompanyCode(shift.companyCode);
          if (normalizeCompanyCode(job.companyCode) !== cc) return null;
          const key = `${cc}:${shiftId}:${jobTypeId}`;
          if (seen.has(key)) return null;
          seen.add(key);
          return {
            id: ensureId(sj?.id),
            companyCode: cc,
            shiftId,
            jobTypeId,
            createdAt: ensureCreatedAt(sj?.createdAt),
          };
        })
        .filter(Boolean);

      return out;
    },
  };

  const CloudStoreStub = (() => {
    const err = () => new Error("Cloud mode is not implemented yet. Set APP_CONFIG.USE_CLOUD = false.");
    const thrower = () => { throw err(); };
    return {
      _provider: "cloud",
      async init() { throw err(); },
      isReady() { return false; },
      getSaved: thrower,
      getDraft: thrower,
      isDirty: () => false,
      save: async () => { throw err(); },
      resetDraftToSaved: async () => { throw err(); },
      exportJSON: thrower,
      importJSON: async () => { throw err(); },
      wipeAll: async () => { throw err(); },
      wipeCompanyData: async () => { throw err(); },
      migrateLegacyDataOnce: async () => { throw err(); },
      getSession: thrower,
      setSession: thrower,
      clearSession: thrower,
      requireAuth: thrower,
      getCompanyCode: thrower,
      normalizeCompanyCode,
      tenantGuard: thrower,
    };
  })();

  function selectStoreProvider() {
    const cfg = globalThis.APP_CONFIG || {};
    const wantsCloud = cfg?.USE_CLOUD === true && !!cfg?.SUPABASE_URL && !!cfg?.SUPABASE_ANON_KEY;
    if (wantsCloud) return CloudStoreStub;
    return Store;
  }

  // Expose globally (adapter pattern)
  window.JanitorStoreLocal = Store;
  window.JanitorStore = selectStoreProvider();
  if (!window.JanitorStore._provider) window.JanitorStore._provider = window.JanitorStore === Store ? "local" : "cloud";

  // Auto-init convenience
  // Pages can: await JanitorStore.init();
})();
