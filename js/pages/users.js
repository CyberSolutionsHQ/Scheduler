import { getSupabase } from "../supabaseClient.js";
import {
  assertPin,
  handleAuthError,
  normalizeUsername,
  requireAuth,
  signOut,
} from "../auth.js";
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

(async () => {
  const companyPicker = document.getElementById("companyPicker");
  const createCard = document.getElementById("createCard");
  const createForm = document.getElementById("createForm");
  const empSelect = document.getElementById("empSelect");
  const usernameEl = document.getElementById("newUsername");
  const pinEl = document.getElementById("newPin");
  const createHint = document.getElementById("createHint");
  const usersList = document.getElementById("usersList");
  const metaEl = document.getElementById("meta");

  try {
    if (!supabase) throw new Error("Missing Supabase configuration for production. Set repo secrets SUPABASE_URL and SUPABASE_ANON_KEY.");
    const profile = await requireAuth({ allowRoles: ["manager", "platform_admin"] });
    if (!profile) return;

    renderAppHeader({
      subtitle: "Users / Access",
      profile,
      activeHref: "./users.html",
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

    async function loadEmployees() {
      if (!empSelect) return;
      if (profile.role === "platform_admin") {
        empSelect.innerHTML = `<option value="">Managers cannot create employee logins here.</option>`;
        empSelect.disabled = true;
        return;
      }

      const { data, error } = await supabase
        .from("employees")
        .select('id, "companyCode", name, active')
        .eq("companyCode", companyCode)
        .eq("active", true)
        .order("name");
      if (error) throw new Error(error.message);

      const rows = data || [];
      empSelect.innerHTML = "";
      if (!rows.length) {
        empSelect.innerHTML = `<option value="">No active employees found</option>`;
        empSelect.disabled = true;
        return;
      }

      empSelect.disabled = false;
      empSelect.insertAdjacentHTML("beforeend", `<option value="">Select an employee…</option>`);
      rows.forEach((emp) => {
        const opt = document.createElement("option");
        opt.value = emp.id;
        opt.textContent = emp.name;
        empSelect.appendChild(opt);
      });
    }

    async function refresh() {
      if (profile.role === "platform_admin" && !companyCode) {
        if (usersList) {
          usersList.innerHTML = `<div class="small">Select a company to view users.</div>`;
        }
        if (metaEl) metaEl.textContent = "Company: —";
        if (createCard) createCard.style.display = "none";
        return;
      }

      if (createCard) {
        createCard.style.display = profile.role === "manager" ? "block" : "none";
      }
      if (createHint) {
        createHint.textContent =
          profile.role === "manager"
            ? "Employee logins take effect immediately."
            : "Platform admins can reset manager PINs from the list below.";
      }

      let q = supabase
        .from("users")
        .select('id, "companyCode", username, role, "employeeId", active, force_pin_change')
        .order("role")
        .order("username");
      if (companyCode) q = q.eq("companyCode", companyCode);

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      if (metaEl) metaEl.textContent = `Company: ${companyCode}`;
      if (!data?.length) {
        usersList.innerHTML = `<div class="small">No accounts found.</div>`;
        return;
      }

      usersList.innerHTML = data
        .map((user) => {
          const canReset =
            profile.role === "manager"
              ? user.role === "employee"
              : user.role === "manager";
          const resetButton = canReset
            ? `<button class="btn secondary" data-action="reset-pin" data-username="${user.username}">Reset PIN</button>`
            : "";
          return `
            <div class="item">
              <div class="meta">
                <strong>${user.username}</strong>
                <div class="muted">${user.role} • ${user.active ? "Active" : "Inactive"}</div>
                <div class="actions" style="margin-top:8px;">${resetButton}</div>
              </div>
            </div>
          `;
        })
        .join("");
    }

    usersList?.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action='reset-pin']");
      if (!btn) return;
      const username = btn.getAttribute("data-username") || "";
      try {
        const newPin = assertPin(window.prompt("New 4-digit PIN:", "") || "", "New PIN");
        const { data, error } = await supabase.functions.invoke("reset_user_pin", {
          body: { companyCode, username, newPin },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        toast("PIN updated.", { type: "success" });
      } catch (err) {
        if (await handleAuthError(err)) return;
        toast(err instanceof Error ? err.message : "Reset failed.", { type: "error" });
      }
    });

    createForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const employeeId = String(empSelect?.value || "").trim();
        const username = normalizeUsername(String(usernameEl?.value || "").trim());
        const pin = assertPin(String(pinEl?.value || "").trim(), "PIN");

        if (!employeeId) throw new Error("Select an employee.");

        const { data, error } = await supabase.functions.invoke("create_employee_login", {
          body: {
            companyCode,
            employeeId,
            username,
            pin,
          },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        if (usernameEl) usernameEl.value = "";
        if (pinEl) pinEl.value = "";
        toast("Employee login created.", { type: "success" });
        await refresh();
      } catch (err) {
        if (await handleAuthError(err)) return;
        toast(err instanceof Error ? err.message : "Create failed.", { type: "error" });
      }
    });

    await loadCompaniesIfNeeded();
    await loadEmployees();
    await refresh();
  } catch (err) {
    if (await handleAuthError(err)) return;
    toast(err instanceof Error ? err.message : "Failed to load users.", { type: "error" });
  }
})();
