import { getSupabase } from "../supabaseClient.js";
import { handleAuthError, requireAuth, signOut } from "../auth.js";
import { renderAppHeader, toast } from "../ui.js";

const supabase = (() => {
  try {
    return getSupabase();
  } catch {
    return null;
  }
})();

function wireLogout() {
  const link = document.getElementById("logoutLink");
  link?.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await signOut();
    } finally {
      location.href = "./login.html";
    }
  });
}

async function loadManagerCounts({ companyCode }) {
  const out = { employees: 0, pendingRequests: 0 };
  const opts = { head: true, count: "exact" };

  const [employees, requests] = await Promise.all([
    supabase.from("employees").select("*", opts).eq("companyCode", companyCode),
    supabase
      .from("credential_reset_requests")
      .select("*", opts)
      .eq("company_code", companyCode)
      .eq("status", "pending"),
  ]);

  if (employees.error) throw new Error(employees.error.message);
  if (requests.error) throw new Error(requests.error.message);

  out.employees = employees.count ?? 0;
  out.pendingRequests = requests.count ?? 0;
  return out;
}

async function renderPlatformAdmin() {
  const adminCard = document.getElementById("adminCard");
  const managerCard = document.getElementById("managerCard");
  if (adminCard) adminCard.style.display = "block";
  if (managerCard) managerCard.style.display = "none";

  const listEl = document.getElementById("companiesList");
  const form = document.getElementById("createCompanyForm");
  const resultEl = document.getElementById("createCompanyResult");

  async function refresh() {
    listEl.innerHTML = `<div class="small">Loading…</div>`;
    const { data, error } = await supabase
      .from("companies")
      .select('id, "companyCode", "companyName", "isDisabled", "supportEnabled", "createdAt"')
      .order("companyCode");
    if (error) throw new Error(error.message);

    if (!data?.length) {
      listEl.innerHTML = `<div class="small">No companies found.</div>`;
      return;
    }

    listEl.innerHTML = `
      <div class="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Code</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${data
              .map((c) => {
                const status = c.isDisabled ? "Disabled" : "Active";
                return `
                  <tr>
                    <td>${c.companyName}</td>
                    <td><strong>${c.companyCode}</strong></td>
                    <td>${status}</td>
                    <td>${new Date(c.createdAt).toLocaleString()}</td>
                    <td>
                      <button class="btn danger" data-action="terminate" data-code="${c.companyCode}" ${
                        c.companyCode === "PLATFORM" || c.isDisabled ? "disabled" : ""
                      }>Terminate</button>
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action='terminate']");
    if (!btn) return;
    const companyCode = btn.getAttribute("data-code") || "";
    const ok = window.confirm(`Terminate ${companyCode}? This disables the company and deactivates its users.`);
    if (!ok) return;
    try {
      const { data, error } = await supabase.functions.invoke("terminate_company", {
        body: { companyCode },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast("Company terminated.", { type: "success" });
      await refresh();
    } catch (err) {
      if (await handleAuthError(err)) return;
      toast(err instanceof Error ? err.message : "Terminate failed.", { type: "error" });
    }
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (resultEl) resultEl.textContent = "";

    const companyName = String(document.getElementById("companyName")?.value || "").trim();
    const companyCode = String(document.getElementById("companyCode")?.value || "").trim();
    const managerUsername = String(document.getElementById("managerUsername")?.value || "").trim();
    const managerPin = String(document.getElementById("managerPin")?.value || "").trim();

    try {
      const { data, error } = await supabase.functions.invoke("create_company_with_manager", {
        body: { companyName, companyCode, managerUsername, managerPin },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      if (resultEl) {
        resultEl.textContent = `Created ${data.companyCode}. Manager: ${data.managerUsername} / PIN: ${data.managerPin}`;
      }
      toast("Company created.", { type: "success" });
      form.reset();
      await refresh();
    } catch (err) {
      if (await handleAuthError(err)) return;
      toast(err instanceof Error ? err.message : "Create failed.", { type: "error" });
    }
  });

  await refresh();
}

async function renderManager() {
  const adminCard = document.getElementById("adminCard");
  const managerCard = document.getElementById("managerCard");
  if (adminCard) adminCard.style.display = "none";
  if (managerCard) managerCard.style.display = "block";

  const countsEl = document.getElementById("counts");
  const counts = await loadManagerCounts({ companyCode: profile.companyCode });
  countsEl.innerHTML =
    `Employees: <strong>${counts.employees}</strong><br/>` +
    `Pending requests: <strong>${counts.pendingRequests}</strong>`;
}

(async () => {
  try {
    if (!supabase) return;
    const profile = await requireAuth();
    if (!profile) return;

    if (profile.role === "employee") {
      location.href = "./my-shifts.html";
      return;
    }

    renderAppHeader({
      subtitle: profile.role === "platform_admin" ? "Platform Admin dashboard" : "Manager dashboard",
      profile,
      activeHref: "./dashboard.html",
    });
    wireLogout();

    if (profile.role === "platform_admin") await renderPlatformAdmin();
    else await renderManager();
  } catch (err) {
    if (await handleAuthError(err)) return;
    toast(err instanceof Error ? err.message : "Failed to load dashboard.", { type: "error" });
  }
})();
