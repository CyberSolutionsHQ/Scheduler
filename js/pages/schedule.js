import { getSupabase } from "../supabaseClient.js";
import { handleAuthError, requireAuth, signOut } from "../auth.js";
import { addDays, getMonday, toISODate } from "../date.js";
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
  const companyPicker = document.getElementById("companyPicker");
  const weekEl = document.getElementById("weekStart");
  const createWeekBtn = document.getElementById("createWeekBtn");
  const shiftForm = document.getElementById("shiftForm");
  const shiftsEl = document.getElementById("shifts");
  const employeeSelect = document.getElementById("employeeId");
  const locIdInput = document.getElementById("locId");

  try {
    if (!supabase) throw new Error("Supabase is not configured. Set values in js/config.js.");
    const profile = await requireAuth({ allowRoles: ["manager", "platform_admin"] });
    if (!profile) return;

    renderAppHeader({
      subtitle: "Weekly schedule",
      profile,
      activeHref: "./schedule.html",
    });
    wireLogout();

    let companyCode = profile.companyCode;
    let company_code = profile.companyCode;

    const monday = getMonday(new Date());
    weekEl.value = toISODate(monday);

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
        company_code = companyCode;
        await refresh();
      });

      companyCode = "";
      company_code = "";
    }

    const employeesById = new Map();

    async function loadEmployees() {
      if (profile.role === "platform_admin" && !companyCode) return;

      let employeesQ = supabase
        .from("employees")
        .select('id, "companyCode", name, active')
        .eq("active", true)
        .order("name");

      if (companyCode) {
        employeesQ = employeesQ.eq("companyCode", companyCode);
      }

      const [employees] = await Promise.all([employeesQ]);
      if (employees.error) throw new Error(employees.error.message);

      employeesById.clear();
      (employees.data || []).forEach((emp) => employeesById.set(emp.id, emp));
      employeeSelect.innerHTML = employees.data
        .map((e) => `<option value="${e.id}">${e.name}</option>`)
        .join("");
    }

    async function getOrFetchSchedule({ weekStart }) {
      let q = supabase
        .from("schedules")
        .select("id, company_code, week_start_date, created_at")
        .eq("week_start_date", weekStart)
        .maybeSingle();
      if (company_code) q = q.eq("company_code", company_code);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data;
    }

    async function createSchedule({ weekStart }) {
      const { data, error } = await supabase
        .from("schedules")
        .insert([{ company_code, week_start_date: weekStart }])
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    }

    async function loadShifts({ scheduleId }) {
      let q = supabase
        .from("shifts")
        .select("id, companyCode, date, start, end, notes, schedule_id, locId, empId")
        .eq("schedule_id", scheduleId)
        .order("date")
        .order("start");
      if (companyCode) q = q.eq("companyCode", companyCode);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    }

    function renderShifts({ shifts }) {
      if (!shifts.length) {
        shiftsEl.innerHTML = `<div class="small">No shifts yet for this week.</div>`;
        return;
      }

      const byDate = new Map();
      for (const s of shifts) {
        const k = s.date;
        const arr = byDate.get(k) || [];
        arr.push(s);
        byDate.set(k, arr);
      }

      shiftsEl.innerHTML = "";
      for (const [date, items] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
          <h2 style="margin:0 0 8px;">${new Date(`${date}T00:00:00`).toLocaleDateString()}</h2>
          <div class="list">
            ${items
              .map(
                (s) => `
                  <div class="item">
                    <div class="meta">
                      <strong>${s.start}–${s.end}</strong>
                      <div class="muted">
                        ${employeesById.get(s.empId)?.name || "—"} • ${s.locId || "—"}
                      </div>
                      ${s.notes ? `<div class="small" style="margin-top:6px;">${s.notes}</div>` : ""}
                    </div>
                    <div class="actions">
                      <button class="btn secondary" data-action="notes" data-id="${s.id}">Notes</button>
                      <button class="btn danger" data-action="delete" data-id="${s.id}">Delete</button>
                    </div>
                  </div>
                `,
              )
              .join("")}
          </div>
        `;
        shiftsEl.appendChild(card);
      }
    }

    let schedule = null;

    async function refresh() {
      shiftsEl.innerHTML = `<div class="small">Loading…</div>`;

      if (profile.role === "platform_admin" && !companyCode) {
        shiftsEl.innerHTML = `<div class="small">Select a company to view schedules.</div>`;
        schedule = null;
        createWeekBtn.disabled = true;
        shiftForm.querySelectorAll("input,select,textarea,button").forEach((el) => (el.disabled = true));
        return;
      }

      const weekStart = toISODate(getMonday(new Date(weekEl.value)));
      weekEl.value = weekStart;

      await loadEmployees();
      schedule = await getOrFetchSchedule({ weekStart });

      const hasSchedule = Boolean(schedule?.id);
      createWeekBtn.disabled = hasSchedule;

      shiftForm.querySelectorAll("input,select,textarea,button").forEach((el) => (el.disabled = !hasSchedule));

      if (!hasSchedule) {
        shiftsEl.innerHTML = `<div class="small">No schedule exists for this week. Click “Create week” to start.</div>`;
        return;
      }

      const shifts = await loadShifts({ scheduleId: schedule.id });
      renderShifts({ shifts });
    }

    createWeekBtn.addEventListener("click", async () => {
      try {
        const weekStart = weekEl.value;
        schedule = await createSchedule({ weekStart });
        toast("Week created.", { type: "success" });
        await refresh();
      } catch (err) {
        if (await handleAuthError(err)) return;
        toast(err instanceof Error ? err.message : "Create failed.", { type: "error" });
      }
    });

    weekEl.addEventListener("change", () => refresh());

    shiftForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!schedule?.id) return;

      const date = String(document.getElementById("date")?.value || "").trim();
      const start = String(document.getElementById("start")?.value || "").trim();
      const end = String(document.getElementById("end")?.value || "").trim();
      const notes = String(document.getElementById("notes")?.value || "").trim();
      const empId = String(employeeSelect.value || "").trim();
      const locId = String(locIdInput?.value || "").trim();

      try {
        if (!date) throw new Error("Date is required.");
        if (!start || !end) throw new Error("Start and end time are required.");
        if (!locId) throw new Error("Location ID is required.");

        const { error } = await supabase.from("shifts").insert([
          {
            companyCode,
            schedule_id: schedule.id,
            date,
            start: start.length === 5 ? `${start}:00` : start,
            end: end.length === 5 ? `${end}:00` : end,
            notes,
            locId,
            empId,
            crewId: null,
          },
        ]);
        if (error) throw new Error(error.message);
        toast("Shift added.", { type: "success" });
        shiftForm.reset();

        const monday = getMonday(new Date(weekEl.value));
        document.getElementById("date").value = toISODate(monday);

        await refresh();
      } catch (err) {
        if (await handleAuthError(err)) return;
        toast(err instanceof Error ? err.message : "Create failed.", { type: "error" });
      }
    });

    shiftsEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action][data-id]");
      if (!btn || !schedule?.id) return;
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");

      try {
        if (action === "delete") {
          const ok = window.confirm("Delete this shift?");
          if (!ok) return;
          const { error } = await supabase
            .from("shifts")
            .delete()
            .eq("id", id)
            .eq("companyCode", companyCode);
          if (error) throw new Error(error.message);
          toast("Deleted.", { type: "success" });
          await refresh();
        } else if (action === "notes") {
          const notes = window.prompt("Notes (blank to clear):", "");
          if (notes === null) return;
          const { error } = await supabase
            .from("shifts")
            .update({ notes })
            .eq("id", id)
            .eq("companyCode", companyCode);
          if (error) throw new Error(error.message);
          toast("Updated.", { type: "success" });
          await refresh();
        }
      } catch (err) {
        if (await handleAuthError(err)) return;
        toast(err instanceof Error ? err.message : "Action failed.", { type: "error" });
      }
    });

    await loadCompaniesIfNeeded();

    const mondayISO = toISODate(getMonday(new Date()));
    document.getElementById("date").value = mondayISO;

    await refresh();
  } catch (err) {
    if (await handleAuthError(err)) return;
    toast(err instanceof Error ? err.message : "Failed to load schedule.", { type: "error" });
  }
})();
