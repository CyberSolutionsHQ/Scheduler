import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type AppRole = "platform_admin" | "manager" | "employee";

export type CallerContext = {
  authUserId: string;
  role: AppRole;
  companyCode: string;
  employeeId: string | null;
  active: boolean;
};

export function json(
  body: unknown,
  init: ResponseInit & { status?: number } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

export function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function createAdminClient(): SupabaseClient {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "schedule-manager-edge" } },
  });
}

export function normalizeCompanyCode(companyCode: string): string {
  const code = (companyCode ?? "").trim().toUpperCase();
  if (!code) throw new Error("companyCode is required");
  return code;
}

export function normalizeUsername(username: string): string {
  const u = (username ?? "").trim().toLowerCase();
  if (!u) throw new Error("username is required");
  return u;
}

export function assertPin(pin: string, field = "pin"): void {
  const p = (pin ?? "").trim();
  if (!/^\d{4}$/.test(p)) throw new Error(`${field} must be a 4-digit string`);
}

export function internalEmail(companyCode: string, username: string): string {
  return `${companyCode}+${username}@yourapp.local`;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

export async function computePinHash(
  companyCode: string,
  username: string,
  pin: string,
): Promise<string> {
  try {
    return await sha256Hex(`${companyCode}:${username}:${pin}`);
  } catch {
    return `plain:${pin}`;
  }
}

export function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer (.+)$/i);
  if (!match) throw new Error("Missing Authorization: Bearer <token>");
  return match[1];
}

export async function getCallerContext(
  supabaseAdmin: SupabaseClient,
  req: Request,
): Promise<CallerContext> {
  const token = getBearerToken(req);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) throw new Error("Invalid auth token");

  const authUserId = data.user.id;

  const { data: row, error: rowError } = await supabaseAdmin
    .from("users")
    .select('id, role, "companyCode", "employeeId", active')
    .eq("id", authUserId)
    .single();

  if (rowError || !row) throw new Error("User mapping not found");

  return {
    authUserId: row.id,
    role: row.role,
    companyCode: row.companyCode,
    employeeId: row.employeeId,
    active: row.active,
  };
}

export function assertCallerActive(caller: CallerContext): void {
  if (!caller.active) throw new Error("User is inactive");
}

