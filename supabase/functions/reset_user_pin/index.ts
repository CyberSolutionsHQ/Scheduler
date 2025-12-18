import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  assertCallerActive,
  assertPin,
  computePinHash,
  createAdminClient,
  getCallerContext,
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

    const body = await req.json();
    const companyCode = normalizeCompanyCode(String(body.companyCode ?? ""));
    const username = normalizeUsername(String(body.username ?? ""));
    const newPin = String(body.newPin ?? "").trim();
    assertPin(newPin, "newPin");

    const { data: target, error: targetError } = await supabaseAdmin
      .from("users")
      .select('id, role, "companyCode", username')
      .eq("companyCode", companyCode)
      .eq("username", username)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!target) throw new Error("User not found");

    if (caller.role === "platform_admin") {
      if (target.role !== "manager") throw new Error("forbidden");
    } else if (caller.role === "manager") {
      if (companyCode !== caller.companyCode) throw new Error("forbidden");
      if (target.role !== "employee") throw new Error("forbidden");

      const { data: companyRow, error: companyError } = await supabaseAdmin
        .from("companies")
        .select('"isDisabled"')
        .eq("companyCode", companyCode)
        .maybeSingle();
      if (companyError) throw new Error(companyError.message);
      if (!companyRow || companyRow.isDisabled) {
        throw new Error("Company is disabled");
      }
    } else {
      throw new Error("forbidden");
    }

    const { error: authUpdateError } = await supabaseAdmin.auth.admin
      .updateUserById(target.id, { password: newPin });
    if (authUpdateError) throw new Error(authUpdateError.message);

    const pinHash = await computePinHash(companyCode, username, newPin);
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ pinHash, active: true })
      .eq("id", target.id);
    if (updateError) throw new Error(updateError.message);

    return json({ ok: true }, { headers: corsHeaders });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400, headers: corsHeaders },
    );
  }
});

