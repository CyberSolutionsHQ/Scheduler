import { handleAuthError, requireAuth } from "../auth.js";
import { renderAppHeader, toast } from "../ui.js";

(async () => {
  const reason = document.body?.dataset?.reason || "This page is not available with the current API contract.";
  const roles = String(document.body?.dataset?.allowedRoles || "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  try {
    const profile = await requireAuth({ allowRoles: roles.length ? roles : undefined });
    if (!profile) return;

    const page = (location.pathname || "").split("/").filter(Boolean).pop() || "";
    renderAppHeader({
      subtitle: "Unavailable",
      profile,
      activeHref: `./${page}`,
    });

    const msgEl = document.getElementById("unsupportedMessage");
    if (msgEl) msgEl.textContent = reason;
  } catch (err) {
    if (await handleAuthError(err)) return;
    toast(err instanceof Error ? err.message : "Failed to load page.", { type: "error" });
  }
})();
