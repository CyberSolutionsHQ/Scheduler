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

type CreateBody = {
  companyCode?: string;
  managerUsername?: string;
  managerPin?: string;
};

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

    const body = (await req.json()) as CreateBody;
    const companyCode = normalizeCompanyCode(String(body.companyCode ?? ""));
    const managerUsername = normalizeUsername(String(body.managerUsername ?? ""));
    const managerPin = String(body.managerPin ?? "").trim();
    assertPin(managerPin, "managerPin");

    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select('"companyCode", "isDisabled"')
      .eq("companyCode", companyCode)
      .maybeSingle();
    if (companyError) throw new Error(companyError.message);
    if (!company) throw new Error("Company not found");
    if (company.isDisabled) throw new Error("Company is disabled");

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("companyCode", companyCode)
      .eq("username", managerUsername)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) throw new Error("username already in use in this company");

    const email = internalEmail(companyCode, managerUsername);
    const { data: authCreate, error: authError } = await supabaseAdmin.auth
      .admin.createUser({
        email,
        password: managerPin,
        email_confirm: true,
      });
    if (authError || !authCreate.user) {
      throw new Error(authError?.message ?? "Failed to create auth user");
    }

    const managerUserId = authCreate.user.id;
    const pinHash = await computePinHash(companyCode, managerUsername, managerPin);

    const { error: insertError } = await supabaseAdmin.from("users").insert({
      id: managerUserId,
      companyCode,
      username: managerUsername,
      pinHash,
      role: "manager",
      employeeId: null,
      active: true,
    });

    if (insertError) {
      await supabaseAdmin.auth.admin.deleteUser(managerUserId);
      throw new Error(insertError.message);
    }

    return json(
      {
        ok: true,
        companyCode,
        managerUsername,
        managerPin,
        managerUserId,
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
