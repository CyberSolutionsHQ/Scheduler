import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  assertCallerActive,
  createAdminClient,
  getCallerContext,
  json,
  normalizeCompanyCode,
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
    const companyCode = normalizeCompanyCode(String(body.companyCode ?? ""));
    if (companyCode === "PLATFORM") throw new Error("Cannot terminate PLATFORM");

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("companies")
      .update({ isDisabled: true })
      .eq("companyCode", companyCode)
      .select('id, "companyCode", "isDisabled"');
    if (updateError) throw new Error(updateError.message);
    if (!updated || updated.length === 0) throw new Error("Company not found");

    await supabaseAdmin
      .from("users")
      .update({ active: false })
      .eq("companyCode", companyCode);

    return json({ ok: true }, { headers: corsHeaders });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400, headers: corsHeaders },
    );
  }
});

