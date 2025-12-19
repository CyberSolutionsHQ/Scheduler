import { getSupabase } from "./supabaseClient.js";

export function normalizeCompanyCode(value) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!code) throw new Error("Company code is required.");
  return code;
}

export function normalizeUsername(value) {
  const username = String(value ?? "").trim().toLowerCase();
  if (!username) throw new Error("Username is required.");
  return username;
}

export function assertPin(value, field = "PIN") {
  const pin = String(value ?? "").trim();
  if (!/^\d{4}$/.test(pin)) throw new Error(`${field} must be exactly 4 digits.`);
  return pin;
}

export function normalizeEmail(value) {
  const email = String(value ?? "").trim();
  if (!email) throw new Error("Email is required.");
  if (!email.includes("@")) throw new Error("Email must include '@'.");
  return email;
}

// Must match `internalEmail()` in `supabase/functions/_shared/admin.ts`.
export function internalEmail(companyCode, username) {
  return `${normalizeCompanyCode(companyCode)}+${normalizeUsername(username)}@yourapp.local`;
}

export async function signInWithCompanyUsernamePin({ companyCode, username, pin }) {
  const supabase = getSupabase();
  const email = internalEmail(companyCode, username);
  const password = assertPin(pin);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

export async function signInWithEmailPin({ email, pin }) {
  const supabase = getSupabase();
  const password = assertPin(pin);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizeEmail(email),
    password,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function signOut() {
  const supabase = getSupabase();
  await supabase.auth.signOut();
}

export async function getCurrentUserProfile() {
  const supabase = getSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(authError.message);
  const userId = authData?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("users")
    .select('id, "companyCode", company_code, username, role, "employeeId", active, force_pin_change')
    .eq("id", userId)
    .single();

  if (error) throw new Error(error.message);

  return {
    id: data.id,
    companyCode: data.companyCode,
    company_code: data.company_code,
    username: data.username,
    role: data.role,
    employeeId: data.employeeId,
    active: data.active,
    forcePinChange: Boolean(data.force_pin_change),
  };
}

function pageNameWithQuery() {
  const name = (location.pathname || "").split("/").filter(Boolean).pop() || "dashboard.html";
  return `${name}${location.search || ""}`;
}

export function goToLogin({ next } = {}) {
  const q = next ? `?next=${encodeURIComponent(String(next))}` : `?next=${encodeURIComponent(pageNameWithQuery())}`;
  location.href = `./login.html${q}`;
}

export function goToDashboard() {
  location.href = "./dashboard.html";
}

export async function requireAuth({ allowRoles } = {}) {
  const supabase = getSupabase();

  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const session = data?.session;
  if (!session) {
    goToLogin();
    return null;
  }

  const profile = await getCurrentUserProfile();
  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    goToLogin();
    return null;
  }

  const isChangePinPage = /(^|\/)change-pin\.html$/i.test(location.pathname || "");
  if (profile.forcePinChange && !isChangePinPage) {
    location.href = `./change-pin.html?next=${encodeURIComponent(pageNameWithQuery())}`;
    return null;
  }

  if (Array.isArray(allowRoles) && allowRoles.length > 0 && !allowRoles.includes(profile.role)) {
    goToDashboard();
    return null;
  }

  return profile;
}
