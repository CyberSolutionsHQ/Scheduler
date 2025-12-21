import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  assertCallerActive,
  createAdminClient,
  getCallerContext,
  json,
  normalizeCompanyCode,
} from "../_shared/admin.ts";

type StatusBody = {
  companyCode?: string;
  isDisabled?: boolean;
  reactivateUsers?: boolean;
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

    const body = (await req.json()) as StatusBody;
    const companyCode = normalizeCompanyCode(String(body.companyCode ?? ""));
    const isDisabled = Boolean(body.isDisabled);
    const reactivateUsers = Boolean(body.reactivateUsers);

    if (companyCode === "PLATFORM" && isDisabled) {
      throw new Error("Cannot disable PLATFORM");
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("companies")
      .update({ isDisabled })
      .eq("companyCode", companyCode)
      .select('id, "companyCode", "isDisabled"');
    if (updateError) throw new Error(updateError.message);
    if (!updated || updated.length === 0) throw new Error("Company not found");

    if (isDisabled) {
      await supabaseAdmin.from("users").update({ active: false }).eq("companyCode", companyCode);
    } else if (reactivateUsers) {
      await supabaseAdmin.from("users").update({ active: true }).eq("companyCode", companyCode);
    }

    return json(
      { ok: true, companyCode, isDisabled, reactivateUsers },
      { headers: corsHeaders },
    );
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400, headers: corsHeaders },
    );
  }
});
