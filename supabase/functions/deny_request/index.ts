import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  assertCallerActive,
  createAdminClient,
  getCallerContext,
  json,
} from "../_shared/admin.ts";

function assertUuid(value: string, field: string): void {
  const v = (value ?? "").trim();
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(v)) throw new Error(`${field} must be a UUID`);
}

function appendDecisionNote(existing: string | null, decisionNote: string): string {
  const trimmed = (decisionNote ?? "").trim();
  const line = `Decision: ${trimmed}`;
  return existing && existing.trim().length > 0 ? `${existing}\n${line}` : line;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const supabaseAdmin = createAdminClient();
    const caller = await getCallerContext(supabaseAdmin, req);
    assertCallerActive(caller);

    const body = await req.json();
    const requestId = String(body.requestId ?? "").trim();
    assertUuid(requestId, "requestId");
    const decisionNote = String(body.decisionNote ?? "").trim();

    const { data: requestRow, error: requestError } = await supabaseAdmin
      .from("requests")
      .select('id, "companyCode", type, status, "decisionNote"')
      .eq("id", requestId)
      .single();
    if (requestError) throw new Error(requestError.message);
    if (requestRow.status !== "pending") throw new Error("Request is not pending");

    const requestType: string = requestRow.type;
    if (requestType === "employee_change_credentials") {
      if (caller.role !== "manager") throw new Error("forbidden");
      if (requestRow.companyCode !== caller.companyCode) throw new Error("forbidden");
    } else if (requestType === "manager_change_credentials") {
      if (caller.role !== "platform_admin") throw new Error("forbidden");
    } else if (requestType === "admin_change_credentials") {
      if (caller.role !== "platform_admin") throw new Error("forbidden");
    } else {
      throw new Error("Unknown request type");
    }

    const { error: requestUpdateError } = await supabaseAdmin
      .from("requests")
      .update({
        status: "denied",
        handledAt: new Date().toISOString(),
        handledBy: caller.authUserId,
        decisionNote: appendDecisionNote(requestRow.decisionNote, decisionNote),
      })
      .eq("id", requestRow.id);
    if (requestUpdateError) throw new Error(requestUpdateError.message);

    return json({ ok: true }, { headers: corsHeaders });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400, headers: corsHeaders },
    );
  }
});

