import { getSupabase } from "../supabaseClient.js";
import {
  getCurrentUserProfile,
  signInWithCompanyUsernamePin,
} from "../auth.js";
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

function setStatus(text) {
  if (statusEl) statusEl.textContent = String(text ?? "");
}

if (companyEl) {
  companyEl.addEventListener("input", () => {
    companyEl.value = String(companyEl.value || "").toUpperCase();
  });
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("");

  const companyCode = String(companyEl?.value || "").trim();
  const username = String(usernameEl?.value || "").trim();
  const pin = String(pinEl?.value || "").trim();

  try {
    await signInWithCompanyUsernamePin({ companyCode, username, pin });
    const profile = await getCurrentUserProfile();
    if (!profile?.active) throw new Error("Account is inactive.");

    const next = qs("next");
    location.href = next ? `./${String(next).replace(/^\//, "")}` : "./dashboard.html";
  } catch (err) {
    toast(err instanceof Error ? err.message : "Login failed.", { type: "error" });
    setStatus(err instanceof Error ? err.message : "Login failed.");
  }
});

