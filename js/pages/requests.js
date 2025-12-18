import { getSupabase } from "../supabaseClient.js";
import { requireAuth, signOut, assertPin, normalizeUsername } from "../auth.js";
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

  try {
    if (!supabase) throw new Error("Supabase is not configured. Set values in js/config.js.");
    const profile = await requireAuth({ allowRoles: ["manager", "platform_admin"] });
    if (!profile) return;

    renderAppHeader({
      subtitle: "Credential reset approvals",
      profile,
      activeHref: "./requests.html",
    });
    wireLogout();

    async function loadUsersByIds(ids) {
      const uniq = [...new Set(ids.filter(Boolean))];
      if (!uniq.length) return new Map();

      const { data, error } = await supabase
        .from("users")
        .select('id, "companyCode", username, role, "employeeId", active')
        .in("id", uniq);
      if (error) throw new Error(error.message);

      const map = new Map();
      for (const u of data || []) map.set(u.id, u);
      return map;
    }

    async function refresh() {
      listEl.innerHTML = `<div class="small">Loading…</div>`;

      const { data, error } = await supabase
        .from("credential_reset_requests")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
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

    async function resolveRequest({ row, target, approve }) {
      if (!target) throw new Error("Target user is not visible (RLS) or does not exist.");

      if (approve) {
        if (row.request_type === "pin") {
          const newPin = assertPin(window.prompt("New 4-digit PIN:", "") || "", "New PIN");
          const { data, error } = await supabase.functions.invoke("reset_user_pin", {
            body: { companyCode: target.companyCode, username: target.username, newPin },
          });
          if (error) throw new Error(error.message);
          if (data?.error) throw new Error(data.error);
        } else if (row.request_type === "username" || row.request_type === "both") {
          if (profile.role !== "manager") {
            throw new Error("Username changes for employees must be handled by a manager (Edge Function).");
          }
          if (target.role !== "employee") {
            throw new Error("Username changes are only implemented for employee accounts.");
          }
          if (!target.employeeId) throw new Error("Target employeeId is missing.");

          const newUsername = normalizeUsername(window.prompt("New username:", "") || "");
          const newPin = assertPin(window.prompt("New 4-digit PIN:", "") || "", "New PIN");

          const { data, error } = await supabase.functions.invoke("create_employee_login", {
            body: {
              companyCode: target.companyCode,
              employeeId: target.employeeId,
              username: newUsername,
              pin: newPin,
            },
          });
          if (error) throw new Error(error.message);
          if (data?.error) throw new Error(data.error);
        } else {
          throw new Error("Unsupported request type.");
        }
      }

      const { error: updateError } = await supabase
        .from("credential_reset_requests")
        .update({
          status: approve ? "approved" : "denied",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (updateError) throw new Error(updateError.message);
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

        await resolveRequest({
          row,
          target: users[row.target_user_id] || null,
          approve: action === "approve",
        });
        toast(action === "approve" ? "Approved." : "Denied.", { type: "success" });
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : "Action failed.", { type: "error" });
      }
    });

    document.getElementById("refreshBtn")?.addEventListener("click", () => refresh());

    await refresh();
  } catch (err) {
    toast(err instanceof Error ? err.message : "Failed to load requests.", { type: "error" });
  }
})();

