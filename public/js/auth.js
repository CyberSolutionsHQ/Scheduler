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

const MIN_PASSWORD_LENGTH = 8;

export function assertPin(value, field = "Password") {
  const password = String(value ?? "").trim();
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`${field} must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return password;
}

export function normalizeEmail(value) {
  const email = String(value ?? "").trim();
  if (!email) throw new Error("Email is required.");
  if (!email.includes("@")) throw new Error("Email must include '@'.");
  return email;
}

export async function authLogin(payload) {
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke("auth_login", { body: payload });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);

  const session = data?.session || data?.success?.session;
  const profile = data?.profile || data?.success?.profile;
  if (!session || !profile) throw new Error("Login failed.");

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (sessionError) throw new Error(sessionError.message);

  return { session, profile };
}

export async function signInWithCompanyUsernamePin({ companyCode, username, pin }) {
  return authLogin({
    companyCode: normalizeCompanyCode(companyCode),
    username: normalizeUsername(username),
    pin: assertPin(pin),
  });
}

export async function signInWithEmailPin({ email, pin }) {
  return authLogin({
    email: normalizeEmail(email),
    pin: assertPin(pin),
  });
}

export async function signOut() {
  const supabase = getSupabase();
  await supabase.auth.signOut();
}

export function isAuthError(error) {
  const status = error?.status || error?.statusCode;
  return status === 401 || status === 403;
}

export async function handleAuthError(error) {
  if (!isAuthError(error)) return false;
  try {
    await signOut();
  } finally {
    goToLogin();
  }
  return true;
}

export async function getCurrentUserProfile() {
  const supabase = getSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(authError.message);
  const userId = authData?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("users")
    .select('id, "companyCode", username, role, "employeeId", active, force_pin_change')
    .eq("id", userId)
    .single();

  if (error) throw new Error(error.message);

  return {
    id: data.id,
    companyCode: data.companyCode,
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
