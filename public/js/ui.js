export function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[m]);
}

export function qs(key) {
  return new URLSearchParams(location.search).get(key);
}

export function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value ?? "");
}

export function toast(message, { type = "info", ms = 2600 } = {}) {
  const text = String(message ?? "").trim();
  if (!text) return;

  const hostId = "toastHost";
  let host = document.getElementById(hostId);
  if (!host) {
    host = document.createElement("div");
    host.id = hostId;
    Object.assign(host.style, {
      position: "fixed",
      left: "12px",
      right: "12px",
      bottom: "12px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      zIndex: 9999,
      pointerEvents: "none",
    });
    document.body.appendChild(host);
  }

  const item = document.createElement("div");
  item.textContent = text;
  Object.assign(item.style, {
    pointerEvents: "auto",
    padding: "10px 12px",
    borderRadius: "14px",
    border: "1px solid rgba(34,50,72,0.9)",
    background:
      type === "error"
        ? "rgba(42,18,32,0.95)"
        : type === "success"
          ? "rgba(12,30,20,0.92)"
          : "rgba(14,21,32,0.95)",
    color: "var(--text)",
    boxShadow: "var(--shadow)",
    fontSize: "13px",
    fontWeight: "700",
  });

  host.appendChild(item);
  window.setTimeout(() => item.remove(), ms);
}

export function renderAppHeader({
  title = "Cyber Solutions LLC Schedule Manager",
  subtitle = "",
  profile = null,
  activeHref = "",
} = {}) {
  const header = document.getElementById("appHeader");
  if (!header) return;

  const role = profile?.role || "";
  const companyCode = profile?.companyCode || "";
  const username = profile?.username || "";

  const links = [];
  if (role === "platform_admin") {
    links.push({ href: "./dashboard.html", label: "Dashboard" });
    links.push({ href: "./admin.html", label: "Admin Tools" });
    links.push({ href: "./requests.html", label: "Reset Requests" });
    links.push({ href: "./employee-requests.html", label: "Change Requests" });
    links.push({ href: "./account.html", label: "Account" });
  } else if (role === "manager") {
    links.push({ href: "./dashboard.html", label: "Dashboard" });
    links.push({ href: "./employees.html", label: "Employees" });
    links.push({ href: "./schedule.html", label: "Schedule" });
    links.push({ href: "./users.html", label: "Users" });
    links.push({ href: "./requests.html", label: "Reset Requests" });
    links.push({ href: "./employee-requests.html", label: "Change Requests" });
    links.push({ href: "./account.html", label: "Account" });
  } else if (role === "employee") {
    links.push({ href: "./my-shifts.html", label: "My Shifts" });
    links.push({ href: "./account.html", label: "Account" });
  }

  links.push({ href: "#logout", label: "Logout", id: "logoutLink" });

  header.innerHTML = `
    <div class="title">
      <div>
        <h1 class="h1">${escapeHtml(title)}</h1>
        <div class="sub">
          ${escapeHtml(subtitle || "")}
          ${profile ? ` • ${escapeHtml(companyCode)} • ${escapeHtml(username)} (${escapeHtml(role)})` : ""}
        </div>
      </div>
    </div>
    <nav class="nav">
      ${links
        .map((l) => {
          const active = activeHref && l.href === activeHref ? "active" : "";
          const idAttr = l.id ? `id="${escapeHtml(l.id)}"` : "";
          return `<a ${idAttr} class="${active}" href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a>`;
        })
        .join("")}
    </nav>
  `;
}
