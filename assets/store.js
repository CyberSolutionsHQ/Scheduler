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

  const uid = (prefix = "id") =>
    `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;

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
      version: 3,
      lastSavedAt: null,
      lastEditedAt: null,
    },
    settings: {
      companyName: "",
    },
    companies: [],   // {id, companyCode, companyName, isDisabled, createdAt, updatedAt}
    users: [],       // {id, companyCode, username, pinHash|pin, role, employeeId?, active, createdAt, updatedAt}
    requests: [],    // {id, companyCode, createdAt, status, type, requesterRole, requesterUserId, targetUserId, proposedUsername?, proposedPin?, note?, handledByUserId?, handledAt?, decisionNote?}
    employees: [],   // {id, companyCode, name, contact, active, createdAt, updatedAt}
    locations: [],   // {id, companyCode, name, address, active, createdAt, updatedAt}
    jobTypes: [],    // {id, companyCode, name, active, createdAt, updatedAt}
    crews: [],       // {id, companyCode, name, active, createdAt, updatedAt}
    crewMembers: [], // {id, companyCode, crewId, empId, createdAt, updatedAt}
    shifts: [],      // {id, companyCode, targetType: "employee"|"crew", targetId, locId, date, start, end, jobTypeIds[], notes, createdAt, updatedAt}
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

    async init() {
      if (this._ready) return;
      await storage.init();

      const saved = await storage.getSavedState();
      this._saved = this._normalize(saved || emptyState());

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

    isReady() { return this._ready; },

    // Read-only view
    getSaved({ scope = "active" } = {}) {
      if (scope === "all") {
        const hasSession = !!readSession();
        if (hasSession && getActiveRole() !== "platform_admin") {
          return deepClone(this._scopedToActiveCompany(this._saved));
        }
        return deepClone(this._saved);
      }
      return deepClone(this._scopedToActiveCompany(this._saved));
    },
    getDraft({ scope = "active" } = {}) {
      if (scope === "all") {
        const hasSession = !!readSession();
        if (hasSession && getActiveRole() !== "platform_admin") {
          return deepClone(this._scopedToActiveCompany(this._draft));
        }
        return deepClone(this._draft);
      }
      return deepClone(this._scopedToActiveCompany(this._draft));
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
      next.jobTypes = (next.jobTypes || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
      next.crews = (next.crews || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
      next.crewMembers = (next.crewMembers || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
      next.shifts = (next.shifts || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
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

      const n = String(note || "").trim();

      const isAdminAudit = t === "admin_change_credentials";
      const createdAt = nowISO();

      const req = {
        id: uid("req"),
        companyCode: sessionCompany,
        createdAt,
        status: isAdminAudit ? "approved" : "pending",
        type: t,
        requesterRole: role,
        requesterUserId,
        targetUserId,
        proposedUsername: wantsUsername ? desiredUsername : "",
        proposedPin: wantsPin ? cleanPin : "",
        note: n,
        handledByUserId: isAdminAudit ? requesterUserId : "",
        handledAt: isAdminAudit ? createdAt : "",
        decisionNote: isAdminAudit ? "Self-managed admin credential change." : "",
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
      req.handledByUserId = actorUserId;
      req.handledAt = nowISO();
      req.decisionNote = String(decisionNote || "").trim();
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
      req.handledByUserId = actorUserId;
      req.handledAt = nowISO();
      req.decisionNote = String(decisionNote || "").trim();
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
        this._draft.crewMembers = (this._draft.crewMembers || []).filter(cm => cm.empId !== empId);
        this._draft.shifts = this._draft.shifts.filter(s => !(s.targetType === "employee" && s.targetId === empId));
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
      this._draft.jobTypes.push(j);
      this.markEdited();
      return deepClone(j);
    },

    updateJobType(jobId, patch) {
      const j = this._draft.jobTypes.find(x => x.id === jobId);
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
      const target = (this._draft.jobTypes || []).find(x => x.id === jobId);
      if (!target) throw new Error("Job type not found.");
      if (normalizeCompanyCode(target.companyCode) !== getActiveCompanyCode() && getActiveRole() !== "platform_admin") {
        throw new Error("Job type not found.");
      }
      this._draft.jobTypes = (this._draft.jobTypes || []).filter(x => x.id !== jobId);

      // Remove from shifts
      this._draft.shifts = this._draft.shifts.map(s => ({
        ...s,
        jobTypeIds: (s.jobTypeIds || []).filter(id => id !== jobId),
      }));
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
        this._draft.crewMembers = (this._draft.crewMembers || []).filter(cm => cm.crewId !== crewId);
        this._draft.shifts = (this._draft.shifts || []).filter(s => !(s.targetType === "crew" && s.targetId === crewId));
      }
      this.markEdited();
      return true;
    },

    addCrewMember({ crewId, empId } = {}) {
      const cc = getActiveCompanyCode();
      if (!cc) throw new Error("Missing company code in session. Please sign in again.");
      crewId = String(crewId || "");
      empId = String(empId || "");
      if (!crewId) throw new Error("Crew is required.");
      if (!empId) throw new Error("Employee is required.");

      const crew = (this._draft.crews || []).find(c => c.id === crewId) || null;
      if (!crew || normalizeCompanyCode(crew.companyCode) !== cc) throw new Error("Crew not found.");
      const emp = (this._draft.employees || []).find(e => e.id === empId) || null;
      if (!emp || normalizeCompanyCode(emp.companyCode) !== cc) throw new Error("Employee not found.");

      const exists = (this._draft.crewMembers || []).some(cm =>
        normalizeCompanyCode(cm.companyCode) === cc && cm.crewId === crewId && cm.empId === empId
      );
      if (exists) return false;

      const cm = {
        id: uid("cm"),
        companyCode: cc,
        crewId,
        empId,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      this._draft.crewMembers.push(cm);
      this.markEdited();
      return deepClone(cm);
    },

    removeCrewMember({ crewId, empId } = {}) {
      const cc = getActiveCompanyCode();
      if (!cc) throw new Error("Missing company code in session. Please sign in again.");
      crewId = String(crewId || "");
      empId = String(empId || "");
      const before = (this._draft.crewMembers || []).length;
      this._draft.crewMembers = (this._draft.crewMembers || []).filter(cm => {
        if (normalizeCompanyCode(cm.companyCode) !== cc) return true;
        return !(cm.crewId === crewId && cm.empId === empId);
      });
      if (this._draft.crewMembers.length === before) throw new Error("Crew member not found.");
      this.markEdited();
      return true;
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

      if (!targetType) {
        if (empId) { targetType = "employee"; targetId = empId; }
        else if (crewId) { targetType = "crew"; targetId = crewId; }
      }

      if (!targetType) throw new Error("Assignee type is required.");
      if (!targetId) throw new Error("Assignee is required.");
      if (!locId) throw new Error("Location is required.");
      if (!date) throw new Error("Date is required.");
      if (!start) throw new Error("Start time is required.");
      if (!end) throw new Error("End time is required.");
      if (end <= start) throw new Error("End time must be after start time.");

      // Ensure emp/loc exist (in draft)
      if (targetType === "employee") {
        const emp = (this._draft.employees || []).find(e => e.id === targetId) || null;
        if (!emp || normalizeCompanyCode(emp.companyCode) !== cc) throw new Error("Employee not found.");
      } else if (targetType === "crew") {
        const crew = (this._draft.crews || []).find(c => c.id === targetId) || null;
        if (!crew || normalizeCompanyCode(crew.companyCode) !== cc) throw new Error("Crew not found.");
      } else {
        throw new Error("Invalid assignee type.");
      }
      const loc = (this._draft.locations || []).find(l => l.id === locId) || null;
      if (!loc || normalizeCompanyCode(loc.companyCode) !== cc) throw new Error("Location not found.");

      // Filter jobTypeIds to valid ids
      const validJobs = new Set((this._draft.jobTypes || []).filter(j => normalizeCompanyCode(j.companyCode) === cc).map(j => j.id));
      const jobs = Array.from(new Set((jobTypeIds || []).map(String))).filter(id => validJobs.has(id));

      const s = {
        id: uid("shift"),
        companyCode: cc,
        targetType,
        targetId,
        locId,
        date,
        start,
        end,
        jobTypeIds: jobs,
        notes,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      this._draft.shifts.push(s);
      this.markEdited();
      return deepClone(s);
    },

    updateShift(shiftId, patch) {
      const s = this._draft.shifts.find(x => x.id === shiftId);
      if (!s) throw new Error("Shift not found.");
      if (normalizeCompanyCode(s.companyCode) !== getActiveCompanyCode() && getActiveRole() !== "platform_admin") {
        throw new Error("Shift not found.");
      }

      const next = { ...s, ...patch };

      // Validate
      if (!next.targetType) throw new Error("Assignee type is required.");
      if (!next.targetId) throw new Error("Assignee is required.");
      if (!next.locId) throw new Error("Location is required.");
      if (!next.date) throw new Error("Date is required.");
      if (!next.start) throw new Error("Start time is required.");
      if (!next.end) throw new Error("End time is required.");
      if (String(next.end) <= String(next.start)) throw new Error("End time must be after start time.");

      if (next.targetType === "employee") {
        const emp = (this._draft.employees || []).find(e => e.id === next.targetId) || null;
        if (!emp || normalizeCompanyCode(emp.companyCode) !== normalizeCompanyCode(s.companyCode)) throw new Error("Employee not found.");
      } else if (next.targetType === "crew") {
        const crew = (this._draft.crews || []).find(c => c.id === next.targetId) || null;
        if (!crew || normalizeCompanyCode(crew.companyCode) !== normalizeCompanyCode(s.companyCode)) throw new Error("Crew not found.");
      } else {
        throw new Error("Invalid assignee type.");
      }
      const loc = (this._draft.locations || []).find(l => l.id === next.locId) || null;
      if (!loc || normalizeCompanyCode(loc.companyCode) !== normalizeCompanyCode(s.companyCode)) throw new Error("Location not found.");

      // Normalize jobTypeIds
      if (patch.jobTypeIds !== undefined) {
        const validJobs = new Set((this._draft.jobTypes || []).filter(j => normalizeCompanyCode(j.companyCode) === normalizeCompanyCode(s.companyCode)).map(j => j.id));
        next.jobTypeIds = Array.from(new Set((patch.jobTypeIds || []).map(String))).filter(id => validJobs.has(id));
      } else {
        next.jobTypeIds = Array.isArray(next.jobTypeIds) ? next.jobTypeIds : [];
      }

      next.notes = String(next.notes || "").trim();
      next.updatedAt = nowISO();

      Object.assign(s, next);
      this.markEdited();
      return deepClone(s);
    },

    deleteShift(shiftId) {
      const target = (this._draft.shifts || []).find(x => x.id === shiftId);
      if (!target) throw new Error("Shift not found.");
      if (normalizeCompanyCode(target.companyCode) !== getActiveCompanyCode() && getActiveRole() !== "platform_admin") {
        throw new Error("Shift not found.");
      }
      this._draft.shifts = (this._draft.shifts || []).filter(x => x.id !== shiftId);
      this.markEdited();
      return true;
    },

    /** ---------------------------
     *  Companies (platform admin)
     *  ---------------------------
     */
    addCompany({ companyCode, companyName } = {}) {
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
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      this._draft.companies.push(c);
      this.markEdited();
      return deepClone(c);
    },

    updateCompany(companyIdOrCode, patch = {}) {
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
      match.updatedAt = nowISO();
      this.markEdited();
      return deepClone(match);
    },

    deleteCompany(companyIdOrCode, { deleteData = true, deleteUsers = true } = {}) {
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
        this._draft.jobTypes = (this._draft.jobTypes || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
        this._draft.crews = (this._draft.crews || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
        this._draft.crewMembers = (this._draft.crewMembers || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
        this._draft.shifts = (this._draft.shifts || []).filter(x => normalizeCompanyCode(x.companyCode) !== cc);
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
      const rows = (this._draft.jobTypes || []).filter(j => normalizeCompanyCode(j.companyCode) === cc);
      return deepClone(rows.filter(j => activeOnly ? j.active : true));
    },
    listCrews({ activeOnly = true } = {}) {
      const cc = getActiveCompanyCode();
      const rows = (this._draft.crews || []).filter(c => normalizeCompanyCode(c.companyCode) === cc);
      return deepClone(rows.filter(c => activeOnly ? c.active : true));
    },
    listCrewMembers() {
      const cc = getActiveCompanyCode();
      return deepClone((this._draft.crewMembers || []).filter(cm => normalizeCompanyCode(cm.companyCode) === cc));
    },
    listShifts() {
      const cc = getActiveCompanyCode();
      return deepClone((this._draft.shifts || []).filter(sh => normalizeCompanyCode(sh.companyCode) === cc));
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
      const crewMembersRaw = Array.isArray(s.crewMembers) ? s.crewMembers : [];

      const crews = includeInactiveCrews ? crewsRaw.slice() : crewsRaw.filter(c => c.active !== false);
      crews.sort((a,b) => String(a.name || "").localeCompare(String(b.name || "")));

      const empById = Object.fromEntries(employeesRaw.map(e => [e.id, e]));
      const empIdsByCrewId = {};
      for (const cm of crewMembersRaw) {
        const crewId = String(cm.crewId || "");
        const empId = String(cm.empId || "");
        if (!crewId || !empId) continue;
        if (!empIdsByCrewId[crewId]) empIdsByCrewId[crewId] = new Set();
        empIdsByCrewId[crewId].add(empId);
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

      const shiftTarget = (sh) => {
        const legacyEmpId = String(sh.empId || "");
        const targetType = String(sh.targetType || (legacyEmpId ? "employee" : ""));
        const targetId = String(sh.targetId || legacyEmpId || "");
        return { targetType, targetId };
      };

      if (mode === "daily") {
        if (!parseYMD(date)) return [];
        return deepClone(
          shifts
            .filter(sh => {
              const { targetType, targetId } = shiftTarget(sh);
              return targetType === "crew" && targetId === crewId && String(sh.date || "") === date;
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
              const { targetType, targetId } = shiftTarget(sh);
              return targetType === "crew" && targetId === crewId && ymdSet.has(String(sh.date || ""));
            })
            .sort((a,b) => String(a.date + a.start).localeCompare(String(b.date + b.start)))
        );
      }

      return [];
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
          jobTypes: [],
          crews: [],
          crewMembers: [],
          shifts: [],
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
        jobTypes: pick(s.jobTypes),
        crews: pick(s.crews),
        crewMembers: pick(s.crewMembers),
        shifts: pick(s.shifts),
      };
    },

    _normalize(stateObj) {
      const s = stateObj && typeof stateObj === "object" ? stateObj : emptyState();

      const out = emptyState();

      // meta
      out.meta = {
        ...out.meta,
        ...(s.meta || {}),
      };

      // arrays
      out.settings = { ...(out.settings || {}), ...(s.settings || {}) };
      out.companies = Array.isArray(s.companies) ? s.companies : [];
      out.users = Array.isArray(s.users) ? s.users : [];
      out.requests = Array.isArray(s.requests) ? s.requests : [];
      out.employees = Array.isArray(s.employees) ? s.employees : [];
      out.locations = Array.isArray(s.locations) ? s.locations : [];
      out.jobTypes = Array.isArray(s.jobTypes) ? s.jobTypes : [];
      out.crews = Array.isArray(s.crews) ? s.crews : [];
      out.crewMembers = Array.isArray(s.crewMembers) ? s.crewMembers : [];
      out.shifts = Array.isArray(s.shifts) ? s.shifts : [];

      // ensure required fields exist
      const fixCommon = (obj) => {
        if (!obj.id) obj.id = uid("fix");
        if (obj.active === undefined) obj.active = true;
        if (!obj.createdAt) obj.createdAt = nowISO();
        if (!obj.updatedAt) obj.updatedAt = nowISO();
        return obj;
      };

      out.settings = {
        ...(out.settings || {}),
        companyName: String(out.settings?.companyName || "").trim(),
      };

      out.companies = out.companies.map(c => fixCommon({
        id: String(c.id || ""),
        companyCode: normalizeCompanyCode(c.companyCode || ""),
        companyName: String(c.companyName || "").trim(),
        isDisabled: c.isDisabled !== undefined ? !!c.isDisabled : false,
        active: true,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })).filter(c => c.companyCode && c.companyName);

      const allowedRoles = new Set(["platform_admin", "manager", "employee"]);
      out.users = out.users.map(u => fixCommon({
        id: String(u.id || ""),
        companyCode: normalizeCompanyCode(u.companyCode || ""),
        username: normalizeUsername(u.username),
        pinHash: String(u.pinHash || u.pin || "").trim(),
        role: allowedRoles.has(String(u.role || "")) ? String(u.role) : "employee",
        employeeId: u.employeeId ? String(u.employeeId) : null,
        active: u.active !== undefined ? !!u.active : true,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      })).filter(u => u.companyCode && u.username && u.pinHash);

      const allowedRequestStatuses = new Set(["pending", "approved", "denied"]);
      const allowedRequestTypes = new Set([
        "manager_change_credentials",
        "employee_change_credentials",
        "admin_change_credentials",
      ]);
      const allowedRequestRoles = new Set(["platform_admin", "manager", "employee"]);

      out.requests = out.requests.map(r => {
        const cc = normalizeCompanyCode(r.companyCode || "");
        const status = allowedRequestStatuses.has(String(r.status || "")) ? String(r.status) : "pending";
        const type = allowedRequestTypes.has(String(r.type || "")) ? String(r.type) : "";
        const requesterRole = allowedRequestRoles.has(String(r.requesterRole || "")) ? String(r.requesterRole) : "";
        const proposedUsername = normalizeUsername(r.proposedUsername || "");
        const proposedPin = String(r.proposedPin || "").trim();
        return {
          id: String(r.id || ""),
          companyCode: cc,
          createdAt: String(r.createdAt || "") || nowISO(),
          status,
          type,
          requesterRole,
          requesterUserId: String(r.requesterUserId || ""),
          targetUserId: String(r.targetUserId || ""),
          proposedUsername,
          proposedPin: /^[0-9]{4}$/.test(proposedPin) ? proposedPin : "",
          note: String(r.note || r.reason || "").trim(),
          handledByUserId: String(r.handledByUserId || ""),
          handledAt: String(r.handledAt || ""),
          decisionNote: String(r.decisionNote || "").trim(),
        };
      }).filter(r => r.id && r.companyCode && r.type && r.requesterRole && r.requesterUserId && r.targetUserId);

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
          ? (String(out.settings?.companyName || "").trim() || cc)
          : cc;
        out.companies.push(fixCommon({
          id: uid("co"),
          companyCode: cc,
          companyName: nameFallback,
          isDisabled: false,
          active: true,
          createdAt: nowISO(),
          updatedAt: nowISO(),
        }));
      }

      out.employees = out.employees.map(e => fixCommon({
        id: String(e.id || ""),
        companyCode: normalizeCompanyCode(e.companyCode || defaultCompanyCode),
        name: String(e.name || "").trim(),
        contact: String(e.contact || ""),
        active: e.active !== undefined ? !!e.active : true,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })).filter(e => e.name);

      out.locations = out.locations.map(l => fixCommon({
        id: String(l.id || ""),
        companyCode: normalizeCompanyCode(l.companyCode || defaultCompanyCode),
        name: String(l.name || "").trim(),
        address: String(l.address || ""),
        active: l.active !== undefined ? !!l.active : true,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
      })).filter(l => l.name);

      out.jobTypes = out.jobTypes.map(j => fixCommon({
        id: String(j.id || ""),
        companyCode: normalizeCompanyCode(j.companyCode || defaultCompanyCode),
        name: String(j.name || "").trim(),
        active: j.active !== undefined ? !!j.active : true,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
      })).filter(j => j.name);

      out.crews = out.crews.map(c => fixCommon({
        id: String(c.id || ""),
        companyCode: normalizeCompanyCode(c.companyCode || defaultCompanyCode),
        name: String(c.name || "").trim(),
        active: c.active !== undefined ? !!c.active : true,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })).filter(c => c.name);

      const crewById = Object.fromEntries(out.crews.map(c => [c.id, c]));
      const empById = Object.fromEntries(out.employees.map(e => [e.id, e]));
      const locById = Object.fromEntries(out.locations.map(l => [l.id, l]));
      const jobById = Object.fromEntries(out.jobTypes.map(j => [j.id, j]));

      // Ensure employee accounts reference valid employees (or allow null for defensive compatibility)
      out.users = out.users.map(u => {
        if (String(u.role || "") === "employee") {
          const emp = u.employeeId ? empById[u.employeeId] : null;
          if (u.employeeId && !emp) u.employeeId = null;
          if (emp && normalizeCompanyCode(emp.companyCode) !== normalizeCompanyCode(u.companyCode)) u.employeeId = null;
        } else {
          u.employeeId = null;
        }
        return u;
      });

      out.crewMembers = out.crewMembers.map(cm => fixCommon({
        id: String(cm.id || ""),
        companyCode: normalizeCompanyCode(cm.companyCode || defaultCompanyCode),
        crewId: String(cm.crewId || ""),
        empId: String(cm.empId || ""),
        active: true,
        createdAt: cm.createdAt,
        updatedAt: cm.updatedAt,
      })).filter(cm => {
        const cc = normalizeCompanyCode(cm.companyCode);
        const crew = crewById[cm.crewId];
        const emp = empById[cm.empId];
        if (!crew || !emp) return false;
        return cc === normalizeCompanyCode(crew.companyCode) && cc === normalizeCompanyCode(emp.companyCode);
      });

      // shifts: must have keys
      out.shifts = out.shifts.map(sh => {
        const legacyEmpId = String(sh.empId || "");
        let targetType = String(sh.targetType || "");
        let targetId = String(sh.targetId || "");

        if (!targetType && legacyEmpId) {
          targetType = "employee";
          targetId = legacyEmpId;
        }

        return fixCommon({
          id: String(sh.id || ""),
          companyCode: normalizeCompanyCode(sh.companyCode || defaultCompanyCode),
          targetType,
          targetId,
          locId: String(sh.locId || ""),
          date: String(sh.date || ""),
          start: String(sh.start || ""),
          end: String(sh.end || ""),
          jobTypeIds: Array.isArray(sh.jobTypeIds) ? sh.jobTypeIds.map(String) : [],
          notes: String(sh.notes || ""),
          active: true,
          createdAt: sh.createdAt,
          updatedAt: sh.updatedAt,
        });
      }).filter(sh => {
        const cc = normalizeCompanyCode(sh.companyCode);
        if (!sh.targetType || !sh.targetId || !sh.locId || !sh.date || !sh.start || !sh.end) return false;
        const loc = locById[sh.locId];
        if (!loc || normalizeCompanyCode(loc.companyCode) !== cc) return false;
        if (sh.targetType === "employee") {
          const emp = empById[sh.targetId];
          return !!emp && normalizeCompanyCode(emp.companyCode) === cc;
        }
        if (sh.targetType === "crew") {
          const crew = crewById[sh.targetId];
          return !!crew && normalizeCompanyCode(crew.companyCode) === cc;
        }
        return false;
      });

      // Normalize shift job types to valid company job IDs.
      out.shifts = out.shifts.map(sh => {
        const cc = normalizeCompanyCode(sh.companyCode);
        const valid = new Set(
          Object.values(jobById)
            .filter(j => normalizeCompanyCode(j.companyCode) === cc)
            .map(j => j.id)
        );
        return {
          ...sh,
          jobTypeIds: (sh.jobTypeIds || []).filter(id => valid.has(String(id))),
        };
      });

      return out;
    },
  };

  // Expose globally
  window.JanitorStore = Store;

  // Auto-init convenience
  // Pages can: await JanitorStore.init();
})();
