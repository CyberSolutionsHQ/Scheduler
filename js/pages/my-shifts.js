import { getSupabase } from "../supabaseClient.js";
import { handleAuthError, requireAuth, signOut } from "../auth.js";
import { addDays, toISODate } from "../date.js";
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
  const listEl = document.getElementById("list");
  const rangeEl = document.getElementById("range");

  try {
    if (!supabase) return;
    const profile = await requireAuth({ allowRoles: ["employee"] });
    if (!profile) return;

    renderAppHeader({
      subtitle: "My shifts",
      profile,
      activeHref: "./my-shifts.html",
    });
    wireLogout();

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = addDays(start, 21);

    rangeEl.textContent = `${start.toLocaleDateString()} → ${end.toLocaleDateString()}`;

    if (!profile.employeeId) throw new Error("Employee profile is missing a linked employeeId.");

    const { data, error } = await supabase
      .from("shifts")
      .select("id, date, start, end, notes, locId, empId, companyCode")
      .eq("empId", profile.employeeId)
      .eq("companyCode", profile.companyCode)
      .gte("date", toISODate(start))
      .lte("date", toISODate(end))
      .order("date")
      .order("start");
    if (error) throw new Error(error.message);

    const rows = data || [];
    if (!rows.length) {
      listEl.innerHTML = `<div class="small">No shifts in this range.</div>`;
      return;
    }

    listEl.innerHTML = rows
      .map((s) => {
        const when = new Date(`${s.date}T00:00:00`).toLocaleDateString();
        const site = s.locId || "—";
        return `
          <div class="item">
            <div class="meta">
              <strong>${when} • ${s.start}–${s.end}</strong>
              <div class="muted">Location: ${site}</div>
              ${s.notes ? `<div class="small" style="margin-top:6px;">${s.notes}</div>` : ""}
            </div>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    if (await handleAuthError(err)) return;
    toast(err instanceof Error ? err.message : "Failed to load shifts.", { type: "error" });
  }
})();
