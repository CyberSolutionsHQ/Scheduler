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
  const metaEl = document.getElementById("accountMeta");
  const changeRequestCard = document.getElementById("changeRequestCard");
  const changeRequestForm = document.getElementById("changeRequestForm");
  const newUsernameEl = document.getElementById("newUsername");
  const newPinEl = document.getElementById("newPin");

  const resetRequestCard = document.getElementById("resetRequestCard");
  const resetRequestForm = document.getElementById("resetRequestForm");
  const requestTypeEl = document.getElementById("requestType");

  const adminCredsCard = document.getElementById("adminCredsCard");
  const adminCredsForm = document.getElementById("adminCredsForm");
  const adminUsernameEl = document.getElementById("adminUsername");
  const adminPinEl = document.getElementById("adminPin");

  try {
    if (!supabase) throw new Error("Missing Supabase configuration for production. Set repo secrets SUPABASE_URL and SUPABASE_ANON_KEY.");
    const profile = await requireAuth();
    if (!profile) return;

    renderAppHeader({
      subtitle: "Account",
      profile,
      activeHref: "./account.html",
    });
    wireLogout();

    if (metaEl) {
      metaEl.textContent = `${profile.companyCode} • ${profile.username} (${profile.role})`;
    }

    const isPlatformAdmin = profile.role === "platform_admin";
    const isEmployee = profile.role === "employee";

    if (changeRequestCard) changeRequestCard.style.display = isPlatformAdmin ? "none" : "block";
    if (resetRequestCard) resetRequestCard.style.display = isEmployee ? "block" : "none";
    if (adminCredsCard) adminCredsCard.style.display = isPlatformAdmin ? "block" : "none";

    changeRequestForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const proposedUsername = String(newUsernameEl?.value || "").trim();
        const proposedPinRaw = String(newPinEl?.value || "").trim();
        const proposedPin = proposedPinRaw ? assertPin(proposedPinRaw, "New password") : "";
        const normalizedUsername = proposedUsername ? normalizeUsername(proposedUsername) : "";

        if (!normalizedUsername && !proposedPin) {
          throw new Error("Enter a new username and/or a new password.");
        }

        const { data, error } = await supabase.functions.invoke("submit_change_request", {
          body: {
            proposedUsername: normalizedUsername || undefined,
            proposedPin: proposedPin || undefined,
          },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        if (newUsernameEl) newUsernameEl.value = "";
        if (newPinEl) newPinEl.value = "";
        toast("Request submitted.", { type: "success" });
      } catch (err) {
        if (await handleAuthError(err)) return;
        toast(err instanceof Error ? err.message : "Request failed.", { type: "error" });
      }
    });

    resetRequestForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const requestType = String(requestTypeEl?.value || "").trim();
        if (!requestType) throw new Error("Select a request type.");

        const { data, error } = await supabase.functions.invoke("submit_credential_reset_request", {
          body: { requestType },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        toast("Reset request submitted.", { type: "success" });
      } catch (err) {
        if (await handleAuthError(err)) return;
        toast(err instanceof Error ? err.message : "Reset request failed.", { type: "error" });
      }
    });

    adminCredsForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const newUsername = String(adminUsernameEl?.value || "").trim();
        const newPinRaw = String(adminPinEl?.value || "").trim();
        const newPin = newPinRaw ? assertPin(newPinRaw, "New password") : "";
        const normalizedUsername = newUsername ? normalizeUsername(newUsername) : "";

        if (!normalizedUsername && !newPin) {
          throw new Error("Enter a new username and/or a new password.");
        }
        if (normalizedUsername && !newPin) {
          throw new Error("Changing the username requires setting a new password.");
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
  } catch (err) {
    if (await handleAuthError(err)) return;
    toast(err instanceof Error ? err.message : "Failed to load account.", { type: "error" });
  }
})();
