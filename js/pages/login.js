import { getSupabase } from "../supabaseClient.js";
import {
  getCurrentUserProfile,
  signInWithEmailPin,
  signInWithCompanyUsernamePin,
  assertPin,
} from "../auth.js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config.js";
import { qs, toast } from "../ui.js";

(async () => {
  try {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    if (data?.session) location.href = "./dashboard.html";
  } catch {
    // If config is missing, the submit handler will show the message.
  }
})();

const form = document.getElementById("loginForm");
const companyEl = document.getElementById("companyCode");
const usernameEl = document.getElementById("username");
const pinEl = document.getElementById("pin");
const statusEl = document.getElementById("status");
const recoveryHintEl = document.getElementById("recoveryHint");
const recoveryToggleEl = document.getElementById("recoveryToggle");
const recoveryWrapEl = document.getElementById("recoveryWrap");
const recoveryFormEl = document.getElementById("recoveryForm");
const recoveryTokenEl = document.getElementById("recoveryToken");
const recoveryStatusEl = document.getElementById("recoveryStatus");
const recoveryPinFormEl = document.getElementById("recoveryPinForm");
const recoveryNewPinEl = document.getElementById("recoveryNewPin");
const recoveryConfirmPinEl = document.getElementById("recoveryConfirmPin");

const loginCardEl = form?.closest("section") ?? null;

function setStatus(text) {
  if (statusEl) statusEl.textContent = String(text ?? "");
}

function setRecoveryStatus(text) {
  if (recoveryStatusEl) recoveryStatusEl.textContent = String(text ?? "");
}

if (companyEl) {
  companyEl.addEventListener("input", () => {
    companyEl.value = String(companyEl.value || "").toUpperCase();
  });
}

let recoveryAccessToken = null;

function setRecoveryLock(locked) {
  if (loginCardEl) loginCardEl.style.display = locked ? "none" : "block";
  const controls = form?.querySelectorAll?.("input, button, a") ?? [];
  controls.forEach((el) => {
    if ("disabled" in el) el.disabled = Boolean(locked);
    if (el.tagName === "A") {
      el.tabIndex = locked ? -1 : 0;
      el.setAttribute("aria-disabled", locked ? "true" : "false");
    }
  });

  if (locked) {
    window.onbeforeunload = () => "Finish recovery first.";
  } else if (window.onbeforeunload) {
    window.onbeforeunload = null;
  }
}

function toggleRecovery(show) {
  if (!recoveryWrapEl) return;
  const next = typeof show === "boolean" ? show : recoveryWrapEl.style.display === "none";
  recoveryWrapEl.style.display = next ? "block" : "none";
  if (next) {
    recoveryTokenEl?.focus();
  }
}

const recoveryEnabled = qs("recovery") === "1";
if (recoveryHintEl) recoveryHintEl.style.display = recoveryEnabled ? "block" : "none";
recoveryToggleEl?.addEventListener("click", (e) => {
  e.preventDefault();
  toggleRecovery(true);
});

// Optional manual reveal: Ctrl+Shift+R
window.addEventListener("keydown", (e) => {
  if (!recoveryEnabled) return;
  if (e.ctrlKey && e.shiftKey && String(e.key || "").toLowerCase() === "r") {
    e.preventDefault();
    toggleRecovery();
  }
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("");

  const companyCode = String(companyEl?.value || "").trim();
  const username = String(usernameEl?.value || "").trim();
  const pin = String(pinEl?.value || "").trim();

  try {
    if (!companyCode && username.includes("@")) {
      await signInWithEmailPin({ email: username, pin });
    } else {
      await signInWithCompanyUsernamePin({ companyCode, username, pin });
    }
    const profile = await getCurrentUserProfile();
    if (!profile?.active) throw new Error("Account is inactive.");

    const next = qs("next");
    if (profile.forcePinChange) {
      location.href = `./change-pin.html?next=${encodeURIComponent(next ? String(next) : "dashboard.html")}`;
      return;
    }

    location.href = next ? `./${String(next).replace(/^\//, "")}` : "./dashboard.html";
  } catch (err) {
    toast(err instanceof Error ? err.message : "Login failed.", { type: "error" });
    setStatus(err instanceof Error ? err.message : "Login failed.");
  }
});

recoveryFormEl?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setRecoveryStatus("");

  const token = String(recoveryTokenEl?.value || "").trim();
  if (!token) {
    setRecoveryStatus("Recovery token is required.");
    return;
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("consume_platform_admin_reset_token", {
      plaintext_token: token,
    });
    if (error) throw new Error(error.message);

    const accessToken = String(data?.access_token || "");
    if (!accessToken) throw new Error("Recovery failed.");

    // Never store/cached: keep in memory only.
    recoveryAccessToken = accessToken;
    if (recoveryTokenEl) recoveryTokenEl.value = "";

    if (recoveryPinFormEl) recoveryPinFormEl.style.display = "block";
    if (recoveryFormEl) recoveryFormEl.style.display = "none";
    setRecoveryLock(true);
    recoveryNewPinEl?.focus();
    setRecoveryStatus("Token accepted. Set a new PIN now.");
  } catch (err) {
    setRecoveryStatus(err instanceof Error ? err.message : "Recovery failed.");
  }
});

recoveryPinFormEl?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setRecoveryStatus("");

  if (!recoveryAccessToken) {
    setRecoveryStatus("Recovery session expired. Use a new recovery token.");
    return;
  }

  try {
    const newPin = assertPin(String(recoveryNewPinEl?.value || "").trim(), "New PIN");
    const confirmPin = assertPin(
      String(recoveryConfirmPinEl?.value || "").trim(),
      "Confirm PIN",
    );
    if (newPin !== confirmPin) throw new Error("PINs do not match.");

    const resp = await fetch(`${String(SUPABASE_URL).replace(/\\/$/, "")}/rest/v1/rpc/platform_admin_recovery_set_pin`, {
      method: "POST",
      headers: {
        apikey: String(SUPABASE_ANON_KEY),
        authorization: `Bearer ${recoveryAccessToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ new_pin: newPin }),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => null);
      const message = body?.message || body?.error || "PIN update failed.";
      throw new Error(String(message));
    }

    // Clear sensitive state ASAP.
    recoveryAccessToken = null;
    if (recoveryNewPinEl) recoveryNewPinEl.value = "";
    if (recoveryConfirmPinEl) recoveryConfirmPinEl.value = "";
    setRecoveryLock(false);
    if (recoveryPinFormEl) recoveryPinFormEl.style.display = "none";
    if (recoveryFormEl) recoveryFormEl.style.display = "block";

    toast("PIN updated. Sign in with email + new PIN.", { type: "success" });
    setRecoveryStatus("PIN updated. Sign in with email + new PIN.");
  } catch (err) {
    setRecoveryStatus(err instanceof Error ? err.message : "PIN update failed.");
  }
});
