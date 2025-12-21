import { getSupabase } from "../supabaseClient.js";
import { assertPin, handleAuthError, requireAuth, signOut } from "../auth.js";
import { qs, toast } from "../ui.js";

const statusEl = document.getElementById("status");
const profileLineEl = document.getElementById("profileLine");
const formEl = document.getElementById("changePinForm");
const newPinEl = document.getElementById("newPin");
const confirmPinEl = document.getElementById("confirmPin");

function setStatus(text) {
  if (statusEl) statusEl.textContent = String(text ?? "");
}

(async () => {
  try {
    const supabase = getSupabase();
    const profile = await requireAuth();
    if (!profile) return;

    if (profileLineEl) {
      const who = profile.role === "platform_admin" ? "Platform Admin" : profile.username;
      profileLineEl.textContent = `${who} • ${profile.companyCode || ""}`;
    }

    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
      try {
        await signOut();
      } finally {
        location.href = "./login.html";
      }
    });

    formEl?.addEventListener("submit", async (e) => {
      e.preventDefault();
      setStatus("");

      try {
        const newPin = assertPin(String(newPinEl?.value || "").trim(), "New PIN");
        const confirmPin = assertPin(String(confirmPinEl?.value || "").trim(), "Confirm PIN");
        if (newPin !== confirmPin) throw new Error("PINs do not match.");

        const { error: authError } = await supabase.auth.updateUser({ password: newPin });
        if (authError) throw new Error(authError.message);

        const { error: syncError } = await supabase.rpc("sync_my_pin_hash_and_clear_force_pin_change", {
          new_pin: newPin,
        });
        if (syncError) throw new Error(syncError.message);

        if (newPinEl) newPinEl.value = "";
        if (confirmPinEl) confirmPinEl.value = "";

        toast("PIN updated.", { type: "success" });
        const next = qs("next");
        location.href = next ? `./${String(next).replace(/^\\//, "")}` : "./dashboard.html";
      } catch (err) {
        if (await handleAuthError(err)) return;
        const msg = err instanceof Error ? err.message : "PIN update failed.";
        toast(msg, { type: "error" });
        setStatus(msg);
      }
    });
  } catch (err) {
    if (await handleAuthError(err)) return;
    const msg = err instanceof Error ? err.message : "Failed to load Change PIN.";
    toast(msg, { type: "error" });
    setStatus(msg);
  }
})();
