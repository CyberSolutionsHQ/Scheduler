import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  assertCallerActive,
  assertPin,
  computePinHash,
  createAdminClient,
  getCallerContext,
  internalEmail,
  json,
  normalizeUsername,
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
      .select(
        'id, "companyCode", type, status, "requesterUserId", "targetUserId", "proposedUsername", "proposedPin", "decisionNote"',
      )
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

    const { data: targetUser, error: targetError } = await supabaseAdmin
      .from("users")
      .select('id, "companyCode", username, role')
      .eq("id", requestRow.targetUserId)
      .single();
    if (targetError) throw new Error(targetError.message);

    if (targetUser.companyCode !== requestRow.companyCode) {
      throw new Error("Request/target company mismatch");
    }

    const proposedUsernameRaw = String(requestRow.proposedUsername ?? "");
    const proposedPinRaw = String(requestRow.proposedPin ?? "");

    const hasUsernameChange = proposedUsernameRaw.trim().length > 0;
    const hasPinChange = proposedPinRaw.trim().length > 0;

    const newUsername = hasUsernameChange
      ? normalizeUsername(proposedUsernameRaw)
      : targetUser.username;
    const newPin = hasPinChange ? proposedPinRaw.trim() : null;
    if (newPin) assertPin(newPin, "proposedPin");

    if (newUsername !== targetUser.username) {
      const { data: conflict, error: conflictError } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("companyCode", targetUser.companyCode)
        .eq("username", newUsername)
        .maybeSingle();
      if (conflictError) throw new Error(conflictError.message);
      if (conflict && conflict.id !== targetUser.id) {
        throw new Error("username already in use in this company");
      }
    }

    const authUpdatePayload: {
      email?: string;
      password?: string;
      email_confirm?: boolean;
    } = {};
    if (newUsername !== targetUser.username) {
      authUpdatePayload.email = internalEmail(targetUser.companyCode, newUsername);
      authUpdatePayload.email_confirm = true;
    }
    if (newPin) authUpdatePayload.password = newPin;

    if (Object.keys(authUpdatePayload).length > 0) {
      const { error: authUpdateError } = await supabaseAdmin.auth.admin
        .updateUserById(targetUser.id, authUpdatePayload);
      if (authUpdateError) throw new Error(authUpdateError.message);
    }

    const userUpdate: Record<string, unknown> = { active: true };
    if (newUsername !== targetUser.username) userUpdate.username = newUsername;
    if (newPin) {
      userUpdate.pinHash = await computePinHash(
        targetUser.companyCode,
        newUsername,
        newPin,
      );
    }

    const { error: userUpdateError } = await supabaseAdmin
      .from("users")
      .update(userUpdate)
      .eq("id", targetUser.id);
    if (userUpdateError) throw new Error(userUpdateError.message);

    const { error: requestUpdateError } = await supabaseAdmin
      .from("requests")
      .update({
        status: "approved",
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
