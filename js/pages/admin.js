import { getSupabase } from "../supabaseClient.js";
import { assertPin, handleAuthError, normalizeUsername, requireAuth, signOut } from "../auth.js";
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
  const adminAccountForm = document.getElementById("adminAccountForm");
  const adminUsernameEl = document.getElementById("adminUsername");
  const adminPinEl = document.getElementById("adminPin");

  const createCompanyForm = document.getElementById("createCompanyForm");
  const companyNameEl = document.getElementById("companyName");
  const companyCodeEl = document.getElementById("companyCode");
  const managerUsernameEl = document.getElementById("managerUsername");
  const managerPinEl = document.getElementById("managerPin");
  const createCompanyResult = document.getElementById("createCompanyResult");

  const createManagerForm = document.getElementById("createManagerForm");
  const managerCompanyCodeEl = document.getElementById("managerCompanyCode");
  const newManagerUsernameEl = document.getElementById("newManagerUsername");
  const newManagerPinEl = document.getElementById("newManagerPin");
  const createManagerResult = document.getElementById("createManagerResult");

  const companiesList = document.getElementById("companiesList");

  try {
    if (!supabase) throw new Error("Supabase is not configured. Set values in js/config.js.");
    const profile = await requireAuth({ allowRoles: ["platform_admin"] });
    if (!profile) return;

    renderAppHeader({
      subtitle: "Admin tools",
      profile,
      activeHref: "./admin.html",
    });
    wireLogout();

    async function refreshCompanies() {
      companiesList.innerHTML = `<div class="small">Loading…</div>`;
      const { data, error } = await supabase
        .from("companies")
        .select('"companyCode", "companyName", "isDisabled", "supportEnabled", "createdAt"')
        .order("companyCode");
      if (error) throw new Error(error.message);

      const rows = data || [];
      if (!rows.length) {
        companiesList.innerHTML = `<div class="small">No companies found.</div>`;
        return;
      }

      companiesList.innerHTML = rows
        .map((c) => {
          const status = c.isDisabled ? "Disabled" : "Active";
          return `
            <div class="item">
              <div class="meta">
                <strong>${c.companyName}</strong>
                <div class="muted">${c.companyCode} • ${status}</div>
                <div class="small">Created: ${new Date(c.createdAt).toLocaleString()}</div>
                <div class="actions" style="margin-top:8px;">
                  <button class="btn secondary" data-action="toggle" data-code="${c.companyCode}" data-disabled="${c.isDisabled}">
                    ${c.isDisabled ? "Enable" : "Disable"}
                  </button>
                  <button class="btn danger" data-action="terminate" data-code="${c.companyCode}" ${
                    c.companyCode === "PLATFORM" || c.isDisabled ? "disabled" : ""
                  }>Terminate</button>
                </div>
              </div>
            </div>
          `;
        })
        .join("");

      if (managerCompanyCodeEl) {
        managerCompanyCodeEl.innerHTML = rows
          .map((c) => `<option value="${c.companyCode}">${c.companyCode} — ${c.companyName}</option>`)
          .join("");
      }
    }

    adminAccountForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const newUsername = String(adminUsernameEl?.value || "").trim();
        const newPinRaw = String(adminPinEl?.value || "").trim();
        const newPin = newPinRaw ? assertPin(newPinRaw, "New PIN") : "";
        const normalizedUsername = newUsername ? normalizeUsername(newUsername) : "";

        if (!normalizedUsername && !newPin) {
          throw new Error("Enter a new username and/or a new PIN.");
        }
        if (normalizedUsername && !newPin) {
          throw new Error("Changing the username requires setting a new PIN.");
        }

        const { data, error } = await supabase.functions.invoke("update_admin_credentials", {
          body: {
            newUsername: normalizedUsername || undefined,
            newPin: newPin || undefined,
          },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        if (adminUsernameEl) adminUsernameEl.value = "";
        if (adminPinEl) adminPinEl.value = "";
        toast("Admin credentials updated.", { type: "success" });
      } catch (err) {
        if (await handleAuthError(err)) return;
        toast(err instanceof Error ? err.message : "Update failed.", { type: "error" });
      }
    });

    createCompanyForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (createCompanyResult) createCompanyResult.textContent = "";
      try {
        const companyName = String(companyNameEl?.value || "").trim();
        const companyCode = String(companyCodeEl?.value || "").trim();
        const managerUsername = String(managerUsernameEl?.value || "").trim();
        const managerPin = String(managerPinEl?.value || "").trim();

        const { data, error } = await supabase.functions.invoke("create_company_with_manager", {
          body: { companyName, companyCode, managerUsername, managerPin },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        if (createCompanyResult) {
          createCompanyResult.textContent = `Created ${data.companyCode}. Manager: ${data.managerUsername} / PIN: ${data.managerPin}`;
        }
        createCompanyForm.reset();
        toast("Company created.", { type: "success" });
        await refreshCompanies();
      } catch (err) {
        if (await handleAuthError(err)) return;
        toast(err instanceof Error ? err.message : "Create failed.", { type: "error" });
      }
    });

    createManagerForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (createManagerResult) createManagerResult.textContent = "";
      try {
        const companyCode = String(managerCompanyCodeEl?.value || "").trim();
        const managerUsername = String(newManagerUsernameEl?.value || "").trim();
        const managerPin = String(newManagerPinEl?.value || "").trim();

        const { data, error } = await supabase.functions.invoke("create_manager_account", {
          body: { companyCode, managerUsername, managerPin },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        if (createManagerResult) {
          createManagerResult.textContent = `Created ${data.managerUsername} / PIN: ${data.managerPin}`;
        }
        createManagerForm.reset();
        toast("Manager created.", { type: "success" });
      } catch (err) {
        if (await handleAuthError(err)) return;
        toast(err instanceof Error ? err.message : "Create failed.", { type: "error" });
      }
    });

    companiesList?.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action][data-code]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      const companyCode = btn.getAttribute("data-code") || "";
      const isDisabled = btn.getAttribute("data-disabled") === "true";

      try {
        if (action === "terminate") {
          const ok = window.confirm(`Terminate ${companyCode}? This disables the company and deactivates its users.`);
          if (!ok) return;
          const { data, error } = await supabase.functions.invoke("terminate_company", {
            body: { companyCode },
          });
          if (error) throw new Error(error.message);
          if (data?.error) throw new Error(data.error);
          toast("Company terminated.", { type: "success" });
        } else if (action === "toggle") {
          const nextDisabled = !isDisabled;
          let reactivateUsers = false;
          if (!nextDisabled) {
            reactivateUsers = window.confirm("Reactivate users for this company?");
          }
          const { data, error } = await supabase.functions.invoke("set_company_status", {
            body: { companyCode, isDisabled: nextDisabled, reactivateUsers },
          });
          if (error) throw new Error(error.message);
          if (data?.error) throw new Error(data.error);
          toast(nextDisabled ? "Company disabled." : "Company enabled.", { type: "success" });
        }
        await refreshCompanies();
      } catch (err) {
        if (await handleAuthError(err)) return;
        toast(err instanceof Error ? err.message : "Action failed.", { type: "error" });
      }
    });

    await refreshCompanies();
  } catch (err) {
    if (await handleAuthError(err)) return;
    toast(err instanceof Error ? err.message : "Failed to load admin tools.", { type: "error" });
  }
})();
