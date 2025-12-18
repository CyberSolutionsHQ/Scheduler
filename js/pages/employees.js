import { getSupabase } from "../supabaseClient.js";
import { requireAuth, signOut } from "../auth.js";
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

function normalizeCompanyCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

(async () => {
  const listEl = document.getElementById("list");
  const form = document.getElementById("createForm");
  const companyPicker = document.getElementById("companyPicker");

  try {
    if (!supabase) throw new Error("Supabase is not configured. Set values in js/config.js.");
    const profile = await requireAuth({ allowRoles: ["manager", "platform_admin"] });
    if (!profile) return;

    renderAppHeader({
      subtitle: "Employees",
      profile,
      activeHref: "./employees.html",
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
        companyCode = normalizeCompanyCode(select.value);
        await refresh();
      });
    }

    async function refresh() {
      listEl.innerHTML = `<div class="small">Loading…</div>`;

      if (profile.role === "platform_admin" && !companyCode) {
        listEl.innerHTML = `<div class="small">Select a company to view employees.</div>`;
        return;
      }

      let q = supabase
        .from("employees")
        .select('id, "companyCode", name, contact, active, "createdAt", "updatedAt"')
        .order("name");
      if (companyCode) q = q.eq("companyCode", companyCode);

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      if (!data?.length) {
        listEl.innerHTML = `<div class="small">No employees yet.</div>`;
        return;
      }

      listEl.innerHTML = `
        <div class="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${data
                .map(
                  (e) => `
                    <tr>
                      <td><strong>${e.name}</strong></td>
                      <td>${e.contact || "—"}</td>
                      <td>
                        <input type="checkbox" data-action="toggle" data-id="${e.id}" ${
                          e.active ? "checked" : ""
                        } />
                      </td>
                      <td>
                        <button class="btn danger" data-action="delete" data-id="${e.id}">Delete</button>
                      </td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    }

    listEl.addEventListener("change", async (e) => {
      const cb = e.target.closest("input[type='checkbox'][data-action='toggle']");
      if (!cb) return;
      const id = cb.getAttribute("data-id");
      try {
        const { error } = await supabase.from("employees").update({ active: cb.checked }).eq("id", id);
        if (error) throw new Error(error.message);
        toast("Updated.", { type: "success" });
      } catch (err) {
        cb.checked = !cb.checked;
        toast(err instanceof Error ? err.message : "Update failed.", { type: "error" });
      }
    });

    listEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action='delete']");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const ok = window.confirm("Delete this employee?");
      if (!ok) return;
      try {
        const { error } = await supabase.from("employees").delete().eq("id", id);
        if (error) throw new Error(error.message);
        toast("Deleted.", { type: "success" });
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : "Delete failed.", { type: "error" });
      }
    });

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = String(document.getElementById("name")?.value || "").trim();
      const contact = String(document.getElementById("contact")?.value || "").trim();
      const active = Boolean(document.getElementById("active")?.checked);

      try {
        if (!name) throw new Error("Name is required.");
        if (profile.role === "platform_admin" && !companyCode) throw new Error("Select a company first.");
        const companyCodeToUse = profile.role === "platform_admin" ? companyCode : profile.companyCode;

        const { error } = await supabase
          .from("employees")
          .insert([{ companyCode: companyCodeToUse, name, contact, active }]);
        if (error) throw new Error(error.message);
        toast("Employee created.", { type: "success" });
        form.reset();
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : "Create failed.", { type: "error" });
      }
    });

    await loadCompaniesIfNeeded();
    await refresh();
  } catch (err) {
    toast(err instanceof Error ? err.message : "Failed to load employees.", { type: "error" });
  }
})();
