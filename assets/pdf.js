/* assets/pdf.js
   The Janitor LLC Scheduler - PDF Export Helpers (mobile-friendly)
   Uses print.html template + window.print() flow.

   Requires:
   - assets/store.js
   - assets/app.js
   - print.html (File #9)
*/

(() => {
  "use strict";

  function buildPrintUrl(empId) {
    const base = "print.html";
    const u = new URL(base, window.location.href);
    u.searchParams.set("empId", empId);
    return u.toString();
  }

  function buildCrewPrintUrl({ crewId, mode, date, weekStart } = {}) {
    const base = "print.html";
    const u = new URL(base, window.location.href);
    u.searchParams.set("crewId", String(crewId || ""));
    u.searchParams.set("mode", String(mode || ""));
    if (date) u.searchParams.set("date", String(date));
    if (weekStart) u.searchParams.set("weekStart", String(weekStart));
    return u.toString();
  }

  function buildAllCrewsPrintUrl({ mode, date, weekStart } = {}) {
    const base = "print.html";
    const u = new URL(base, window.location.href);
    u.searchParams.set("report", "crews_all");
    u.searchParams.set("mode", String(mode || ""));
    if (date) u.searchParams.set("date", String(date));
    if (weekStart) u.searchParams.set("weekStart", String(weekStart));
    return u.toString();
  }

  function openPrint(empId, { newTab = true } = {}) {
    const url = buildPrintUrl(empId);

    // Try to open in new tab (best so manager can come back)
    if (newTab) {
      const w = window.open(url, "_blank");
      if (w) return { ok: true, mode: "newTab", url };
      // Popup blocked fallback
      window.location.href = url;
      return { ok: true, mode: "sameTab", url };
    }

    window.location.href = url;
    return { ok: true, mode: "sameTab", url };
  }

  function openCrewPrint({ crewId, mode, date, weekStart } = {}, { newTab = true } = {}) {
    const url = buildCrewPrintUrl({ crewId, mode, date, weekStart });

    if (newTab) {
      const w = window.open(url, "_blank");
      if (w) return { ok: true, mode: "newTab", url };
      window.location.href = url;
      return { ok: true, mode: "sameTab", url };
    }

    window.location.href = url;
    return { ok: true, mode: "sameTab", url };
  }

  function openAllCrewsPrint({ mode, date, weekStart } = {}, { newTab = true } = {}) {
    const url = buildAllCrewsPrintUrl({ mode, date, weekStart });

    if (newTab) {
      const w = window.open(url, "_blank");
      if (w) return { ok: true, mode: "newTab", url };
      window.location.href = url;
      return { ok: true, mode: "sameTab", url };
    }

    window.location.href = url;
    return { ok: true, mode: "sameTab", url };
  }

  function getEmployeesForExport({ includeInactive = false } = {}) {
    const s = window.JanitorStore.getSaved(); // export from saved data
    let emps = Array.isArray(s.employees) ? s.employees : [];
    if (!includeInactive) emps = emps.filter(e => e.active !== false);
    emps.sort((a,b) => (a.name || "").localeCompare(b.name || ""));
    return emps;
  }

  function getCrewsForExport({ includeInactive = false } = {}) {
    const s = window.JanitorStore.getSaved(); // export from saved data
    let crews = Array.isArray(s.crews) ? s.crews : [];
    if (!includeInactive) crews = crews.filter(c => c.active !== false);
    crews.sort((a,b) => (a.name || "").localeCompare(b.name || ""));
    return crews;
  }

  // "All employees" export helper for mobile:
  // It does NOT auto-print every PDF (mobile blocks it), but helps you step through.
  function startExportAllUI(containerEl, { includeInactive = false } = {}) {
    const emps = getEmployeesForExport({ includeInactive });

    if (!containerEl) throw new Error("Missing container element for export UI.");

    if (emps.length === 0) {
      containerEl.innerHTML = `<div class="small">No employees to export.</div>`;
      return;
    }

    let idx = 0;

    const render = () => {
      const emp = emps[idx];
      const safeName = (emp.name || "Employee").replace(/[^a-z0-9-_ ]/gi, "").trim() || "Employee";

      containerEl.innerHTML = `
        <div class="card" style="margin:0; box-shadow:none;">
          <h2 style="margin:0 0 8px;">Export all employees</h2>
          <div class="small">
            ${idx+1} of ${emps.length}<br/>
            Next up: <strong>${window.JanitorApp.escapeHtml(emp.name)}</strong><br/>
            Save as: <strong>Schedule/${window.JanitorApp.escapeHtml(safeName)}.pdf</strong>
          </div>

          <div class="btnRow" style="margin-top:10px;">
            <button class="btn" id="openBtn" type="button">📄 Open print view</button>
            <button class="btn secondary" id="nextBtn" type="button">Next ➜</button>
          </div>

          <div class="btnRow">
            <button class="btn secondary" id="prevBtn" type="button">◀ Prev</button>
            <button class="btn danger" id="stopBtn" type="button">Stop</button>
          </div>

          <div class="small" style="margin-top:10px;">
            Workflow: tap <strong>Open print view</strong> → Print/Save PDF → come back → tap <strong>Next</strong>.
          </div>
        </div>
      `;

      containerEl.querySelector("#openBtn").addEventListener("click", () => {
        openPrint(emp.id, { newTab: true });
        window.JanitorApp.toast("Opened print view. Save as PDF from there.", { type: "success" });
      });

      containerEl.querySelector("#nextBtn").addEventListener("click", () => {
        if (idx < emps.length - 1) idx++;
        render();
      });

      containerEl.querySelector("#prevBtn").addEventListener("click", () => {
        if (idx > 0) idx--;
        render();
      });

      containerEl.querySelector("#stopBtn").addEventListener("click", () => {
        containerEl.innerHTML = `<div class="small">Export all stopped.</div>`;
      });
    };

    render();
  }

  window.JanitorPDF = {
    buildPrintUrl,
    buildCrewPrintUrl,
    buildAllCrewsPrintUrl,
    openPrint,
    openCrewPrint,
    openAllCrewsPrint,
    getEmployeesForExport,
    getCrewsForExport,
    startExportAllUI,
  };
})();
