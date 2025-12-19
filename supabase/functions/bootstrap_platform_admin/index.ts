import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  assertPin,
  computePinHash,
  createAdminClient,
  internalEmail,
  json,
  normalizeUsername,
} from "../_shared/admin.ts";

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

type BootstrapBody = {
  token?: string;
  username?: string;
  pin?: string;
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const supabaseAdmin = createAdminClient();

    const body = (await req.json()) as BootstrapBody;
    const token = String(body.token ?? "").trim();
    const expected = getEnv("BOOTSTRAP_TOKEN");
    if (!token || token !== expected) {
      return json({ error: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const { data: existingAdmins, error: existingError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("role", "platform_admin")
      .limit(1);
    if (existingError) throw new Error(existingError.message);
    if ((existingAdmins ?? []).length > 0) {
      return json(
        { error: "platform_admin already exists" },
        { status: 409, headers: corsHeaders },
      );
    }

    const companyCode = "PLATFORM";
    const username = normalizeUsername(String(body.username ?? ""));
    const pin = String(body.pin ?? "").trim();
    assertPin(pin, "pin");

    await supabaseAdmin
      .from("companies")
      .insert({ companyCode, companyName: "Platform", isDisabled: false, supportEnabled: false })
      .select("id")
      .maybeSingle();

    const email = internalEmail(companyCode, username);
    const { data: authCreate, error: authError } = await supabaseAdmin.auth
      .admin.createUser({
        email,
        password: pin,
        email_confirm: true,
      });
    if (authError || !authCreate.user) {
      throw new Error(authError?.message ?? "Failed to create auth user");
    }

    const authUserId = authCreate.user.id;
    const pinHash = await computePinHash(companyCode, username, pin);

    const { error: insertError } = await supabaseAdmin.from("users").insert({
      id: authUserId,
      companyCode,
      username,
      pinHash,
      role: "platform_admin",
      employeeId: null,
      active: true,
    });

    if (insertError) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      throw new Error(insertError.message);
    }

    return json(
      {
        ok: true,
        companyCode,
        username,
        pin,
        authUserId,
      },
      { headers: corsHeaders },
    );
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400, headers: corsHeaders },
    );
  }
});

