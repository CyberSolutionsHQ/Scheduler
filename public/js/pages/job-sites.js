import { handleAuthError, requireAuth, signOut } from "../auth.js";
import { renderAppHeader, toast } from "../ui.js";

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

  try {
    const profile = await requireAuth({ allowRoles: ["manager", "platform_admin"] });
    if (!profile) return;

    renderAppHeader({
      subtitle: "Job Sites",
      profile,
      activeHref: "./job-sites.html",
    });
    wireLogout();

    if (listEl) {
      listEl.innerHTML =
        `<div class="small">Job site management is not available because the API contract does not expose job site endpoints.</div>`;
    }
  } catch (err) {
    if (await handleAuthError(err)) return;
    toast(err instanceof Error ? err.message : "Failed to load job sites.", { type: "error" });
  }
})();
