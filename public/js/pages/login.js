import { getSupabase } from "../supabaseClient.js";
import {
  getCurrentUserProfile,
  signInWithEmailPin,
  signInWithCompanyUsernamePin,
  normalizeUsername,
  assertPin,
} from "../auth.js";
import { qs, toast } from "../ui.js";

(async () => {
  try {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      const profile = await getCurrentUserProfile();
      if (profile?.role === "platform_admin") location.href = "./admin.html";
      else location.href = "./dashboard.html";
    }
  } catch {
    // If config is missing, the submit handler will show the message.
  }
})();

const form = document.getElementById("loginForm");
const companyEl = document.getElementById("companyCode");
const usernameEl = document.getElementById("username");
const pinEl = document.getElementById("pin");
const statusEl = document.getElementById("status");
const setupCardEl = document.getElementById("setupCard");
const setupFormEl = document.getElementById("setupForm");
const setupTokenEl = document.getElementById("setupToken");
const setupUsernameEl = document.getElementById("setupUsername");
const setupPinEl = document.getElementById("setupPin");
const setupStatusEl = document.getElementById("setupStatus");

const loginCardEl = form?.closest("section") ?? null;

function setStatus(text) {
  if (statusEl) statusEl.textContent = String(text ?? "");
}

function setSetupStatus(text) {
  if (setupStatusEl) setupStatusEl.textContent = String(text ?? "");
}

if (companyEl) {
  companyEl.addEventListener("input", () => {
    companyEl.value = String(companyEl.value || "").toUpperCase();
  });
}

function setSetupVisibility(visible) {
  if (setupCardEl) setupCardEl.style.display = visible ? "block" : "none";
  if (loginCardEl) loginCardEl.style.display = visible ? "none" : "block";
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("");

  const companyCode = String(companyEl?.value || "").trim();
  const username = String(usernameEl?.value || "").trim();
  const pin = String(pinEl?.value || "").trim();

  try {
    let profile = null;
    if (!companyCode && username.includes("@")) {
      ({ profile } = await signInWithEmailPin({ email: username, pin }));
    } else {
      ({ profile } = await signInWithCompanyUsernamePin({ companyCode, username, pin }));
    }
    if (!profile) profile = await getCurrentUserProfile();
    if (!profile?.active) throw new Error("Account is inactive.");

    const next = qs("next");
    const defaultNext = profile.role === "platform_admin" ? "admin.html" : "dashboard.html";
    if (profile.forcePinChange) {
      location.href = `./change-pin.html?next=${encodeURIComponent(next ? String(next) : defaultNext)}`;
      return;
    }

    location.href = next ? `./${String(next).replace(/^\//, "")}` : `./${defaultNext}`;
  } catch (err) {
    toast(err instanceof Error ? err.message : "Login failed.", { type: "error" });
    setStatus(err instanceof Error ? err.message : "Login failed.");
  }
});

setupFormEl?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setSetupStatus("");

  try {
    const supabase = getSupabase();
    const token = String(setupTokenEl?.value || "").trim();
    const username = normalizeUsername(String(setupUsernameEl?.value || "").trim());
    const pin = assertPin(String(setupPinEl?.value || "").trim());

    const { data, error } = await supabase.functions.invoke("bootstrap_platform_admin", {
      body: { token, username, pin },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);

    if (setupTokenEl) setupTokenEl.value = "";
    if (setupUsernameEl) setupUsernameEl.value = "";
    if (setupPinEl) setupPinEl.value = "";

    toast("Platform admin created. Sign in below.", { type: "success" });
    setSetupStatus("Platform admin created. Sign in below.");
    setSetupVisibility(false);
  } catch (err) {
    setSetupStatus(err instanceof Error ? err.message : "Setup failed.");
  }
});

if (setupCardEl) {
  const token = qs("bootstrap") === "1";
  setSetupVisibility(token);
}
