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
  email?: string;
  authUserId?: string;
  username?: string;
  pin?: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

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

    const companyCode = "PLATFORM";
    const authUserIdFromBody = String(body.authUserId ?? "").trim();
    const { data: existingAdmins, error: existingError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("role", "platform_admin")
      .eq("companyCode", companyCode)
      .limit(1);
    if (existingError) throw new Error(existingError.message);
    const existingAdminId = existingAdmins?.[0]?.id ?? null;
    if (existingAdminId && (!authUserIdFromBody || existingAdminId !== authUserIdFromBody)) {
      return json(
        { error: "platform_admin already exists" },
        { status: 409, headers: corsHeaders },
      );
    }
    const emailFromBody = String(body.email ?? "").trim();
    const username = normalizeUsername(String(body.username ?? ""));
    const pin = String(body.pin ?? "").trim();
    assertPin(pin, "pin");

    await supabaseAdmin
      .from("companies")
      .insert({ companyCode, companyName: "Platform", isDisabled: false, supportEnabled: false })
      .select("id")
      .maybeSingle();

    let authUserId: string;
    let email: string;

    if (authUserIdFromBody) {
      if (!isUuid(authUserIdFromBody)) throw new Error("authUserId is invalid");

      if (emailFromBody && (!emailFromBody.includes("@") || /\s/.test(emailFromBody))) {
        throw new Error("email is invalid");
      }

      const { data: authUpdate, error: authUpdateError } = await supabaseAdmin.auth.admin
        .updateUserById(authUserIdFromBody, {
          ...(emailFromBody ? { email: emailFromBody } : {}),
          password: pin,
          email_confirm: true,
        });

      if (authUpdateError) throw new Error(authUpdateError.message);
      authUserId = authUserIdFromBody;
      email = authUpdate?.user?.email ?? emailFromBody;
      if (!email) throw new Error("Failed to resolve auth user email");
    } else {
      email = emailFromBody || internalEmail(companyCode, username);
      if (!email.includes("@") || /\s/.test(email)) {
        throw new Error("email is invalid");
      }

      const { data: authCreate, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: pin,
        email_confirm: true,
      });

      authUserId = authCreate?.user?.id ?? "";
      if (authError || !authUserId) {
        throw new Error(authError?.message ?? "Failed to create auth user");
      }
    }
    const pinHash = await computePinHash(companyCode, username, pin);

    const { error: insertError } = await supabaseAdmin.from("users").upsert({
      id: authUserId,
      companyCode,
      username,
      pinHash,
      role: "platform_admin",
      employeeId: null,
      active: true,
    }, { onConflict: "id" });

    if (insertError) {
      if (!authUserIdFromBody) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
      }
      throw new Error(insertError.message);
    }

    const { count: platformAdminCount, error: countError } = await supabaseAdmin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "platform_admin")
      .eq("companyCode", companyCode);
    if (countError) throw new Error(countError.message);

    return json(
      {
        ok: true,
        companyCode,
        username,
        email,
        authUserId,
        platformAdminCount: platformAdminCount ?? 0,
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
