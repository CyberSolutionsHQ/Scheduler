import { getSupabase } from "../supabaseClient.js";
import { handleAuthError, requireAuth, signOut, assertPin, normalizeUsername } from "../auth.js";
import { renderAppHeader, toast } from "../ui.js";

const supabase = (() => {
  try {
    return getSupabase();
  } catch {
    return null;
  }
})();

function wireLogout() {
  document.getElementById("logoutLink")?.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await signOut();
    } finally {
      location.href = "./login.html";
    }
  });
}

function labelRequestType(type) {
  if (type === "username") return "Username reset";
  if (type === "pin") return "PIN reset";
  if (type === "both") return "Username + PIN reset";
  return type || "—";
}

(async () => {
  const listEl = document.getElementById("list");
  const metaEl = document.getElementById("meta");
  const companyPicker = document.getElementById("companyPicker");

  try {
    if (!supabase) return;
    const profile = await requireAuth({ allowRoles: ["manager", "platform_admin"] });
    if (!profile) return;

    renderAppHeader({
      subtitle: "Credential reset approvals",
      profile,
      activeHref: "./requests.html",
    });
    wireLogout();

    let companyCode = profile.role === "platform_admin" ? "" : profile.companyCode;

    async function loadCompaniesIfNeeded() {
      if (profile.role !== "platform_admin") return;
      companyPicker.style.display = "block";
      const { data, error } = await supabase
        .from("companies")
        .select('"companyCode", "companyName"')
        .order("companyCode");
      if (error) throw new Error(error.message);

      companyPicker.innerHTML = `
        <label for="companySelect">Company</label>
        <select id="companySelect">
          <option value="">Select a company…</option>
          ${data.map((c) => `<option value="${c.companyCode}">${c.companyCode} — ${c.companyName}</option>`).join("")}
        </select>
      `;

      const select = document.getElementById("companySelect");
      select.addEventListener("change", async () => {
        companyCode = String(select.value || "").trim().toUpperCase();
        await refresh();
      });
    }

    async function loadUsersByIds(ids) {
      const uniq = [...new Set(ids.filter(Boolean))];
      if (!uniq.length) return new Map();

      let q = supabase
        .from("users")
        .select('id, "companyCode", username, role, "employeeId", active')
        .in("id", uniq);
      if (companyCode) q = q.eq("companyCode", companyCode);
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      const map = new Map();
      for (const u of data || []) map.set(u.id, u);
      return map;
    }

    async function refresh() {
      listEl.innerHTML = `<div class="small">Loading…</div>`;

      if (profile.role === "platform_admin" && !companyCode) {
        listEl.innerHTML = `<div class="small">Select a company to view requests.</div>`;
        metaEl.textContent = "Pending: —";
        return;
      }

      let q = supabase
        .from("credential_reset_requests")
        .select("id, company_code, requested_by_user_id, target_user_id, request_type, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (companyCode) q = q.eq("company_code", companyCode);
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      const rows = data || [];
      metaEl.textContent = `Pending: ${rows.length}`;

      if (!rows.length) {
        listEl.innerHTML = `<div class="small">No pending requests.</div>`;
        return;
      }

      const ids = rows.flatMap((r) => [r.requested_by_user_id, r.target_user_id]);
      const usersById = await loadUsersByIds(ids);

      listEl.innerHTML = rows
        .map((r) => {
          const requester = usersById.get(r.requested_by_user_id);
          const target = usersById.get(r.target_user_id);
          return `
            <div class="item">
              <div class="meta">
                <strong>${labelRequestType(r.request_type)}</strong>
                <div class="muted">
                  Target: ${target ? `${target.username} (${target.role})` : r.target_user_id}<br/>
                  Requested by: ${requester ? requester.username : r.requested_by_user_id}<br/>
                  Created: ${new Date(r.created_at).toLocaleString()}
                </div>
              </div>
              <div class="actions">
                <button class="btn" data-action="approve" data-id="${r.id}">Approve</button>
                <button class="btn danger" data-action="deny" data-id="${r.id}">Deny</button>
              </div>
            </div>
          `;
        })
        .join("");

      listEl.dataset.users = JSON.stringify(
        Object.fromEntries([...usersById.entries()].map(([k, v]) => [k, v])),
      );
      listEl.dataset.rows = JSON.stringify(rows);
    }

    async function resolveRequest({ row, approve }) {
      let newUsername = "";
      let newPin = "";

      if (approve) {
        if (row.request_type === "pin") {
          newPin = assertPin(window.prompt("New 4-digit PIN:", "") || "", "New PIN");
        } else if (row.request_type === "username") {
          newUsername = normalizeUsername(window.prompt("New username:", "") || "");
        } else if (row.request_type === "both") {
          newUsername = normalizeUsername(window.prompt("New username:", "") || "");
          newPin = assertPin(window.prompt("New 4-digit PIN:", "") || "", "New PIN");
        }
      }

      const { data, error } = await supabase.functions.invoke("resolve_credential_reset_request", {
        body: {
          requestId: row.id,
          approve,
          newUsername: newUsername || undefined,
          newPin: newPin || undefined,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
    }

    listEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action][data-id]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      const id = btn.getAttribute("data-id");

      try {
        const rows = JSON.parse(listEl.dataset.rows || "[]");
        const users = JSON.parse(listEl.dataset.users || "{}");
        const row = rows.find((r) => r.id === id);
        if (!row) throw new Error("Request not found.");

        const ok = window.confirm(action === "approve" ? "Approve this request?" : "Deny this request?");
        if (!ok) return;

        await resolveRequest({ row, approve: action === "approve" });
        toast(action === "approve" ? "Approved." : "Denied.", { type: "success" });
        await refresh();
      } catch (err) {
        if (await handleAuthError(err)) return;
        toast(err instanceof Error ? err.message : "Action failed.", { type: "error" });
      }
    });

    document.getElementById("refreshBtn")?.addEventListener("click", () => refresh());

    await loadCompaniesIfNeeded();
    await refresh();
  } catch (err) {
    if (await handleAuthError(err)) return;
    toast(err instanceof Error ? err.message : "Failed to load requests.", { type: "error" });
  }
})();
