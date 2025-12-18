import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  assertCallerActive,
  assertPin,
  computePinHash,
  createAdminClient,
  getCallerContext,
  internalEmail,
  json,
  normalizeCompanyCode,
  normalizeUsername,
} from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const supabaseAdmin = createAdminClient();
    const caller = await getCallerContext(supabaseAdmin, req);
    assertCallerActive(caller);
    if (caller.role !== "platform_admin") {
      return json({ error: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const body = await req.json();
    const companyName = String(body.companyName ?? "").trim();
    const companyCode = normalizeCompanyCode(String(body.companyCode ?? ""));
    const managerUsername = normalizeUsername(String(body.managerUsername ?? ""));
    const managerPin = String(body.managerPin ?? "").trim();
    assertPin(managerPin, "managerPin");
    if (!companyName) throw new Error("companyName is required");

    const { data: insertedCompany, error: companyError } = await supabaseAdmin
      .from("companies")
      .insert({
        companyCode,
        companyName,
        isDisabled: false,
        supportEnabled: false,
      })
      .select('id, "companyCode"')
      .single();

    if (companyError) throw new Error(companyError.message);

    const email = internalEmail(companyCode, managerUsername);
    const { data: authCreate, error: authError } = await supabaseAdmin.auth
      .admin.createUser({
        email,
        password: managerPin,
        email_confirm: true,
      });

    if (authError || !authCreate.user) {
      await supabaseAdmin.from("companies").delete().eq("id", insertedCompany.id);
      throw new Error(authError?.message ?? "Failed to create auth user");
    }

    const managerUserId = authCreate.user.id;
    const pinHash = await computePinHash(companyCode, managerUsername, managerPin);

    const { error: userRowError } = await supabaseAdmin.from("users").insert({
      id: managerUserId,
      companyCode,
      username: managerUsername,
      pinHash,
      role: "manager",
      employeeId: null,
      active: true,
    });

    if (userRowError) {
      await supabaseAdmin.auth.admin.deleteUser(managerUserId);
      await supabaseAdmin.from("companies").delete().eq("id", insertedCompany.id);
      throw new Error(userRowError.message);
    }

    return json(
      {
        companyCode,
        managerUsername,
        managerPin,
        companyId: insertedCompany.id,
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

