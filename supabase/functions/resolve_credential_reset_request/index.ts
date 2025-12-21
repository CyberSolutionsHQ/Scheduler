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

type ResolveBody = {
  requestId?: string;
  approve?: boolean;
  newUsername?: string;
  newPin?: string;
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const supabaseAdmin = createAdminClient();
    const caller = await getCallerContext(supabaseAdmin, req);
    assertCallerActive(caller);

    if (caller.role !== "manager" && caller.role !== "platform_admin") {
      return json({ error: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const body = (await req.json()) as ResolveBody;
    const requestId = String(body.requestId ?? "").trim();
    assertUuid(requestId, "requestId");
    const approve = Boolean(body.approve);

    const { data: requestRow, error: requestError } = await supabaseAdmin
      .from("credential_reset_requests")
      .select(
        "id, company_code, requested_by_user_id, target_user_id, request_type, status",
      )
      .eq("id", requestId)
      .single();
    if (requestError) throw new Error(requestError.message);
    if (requestRow.status !== "pending") throw new Error("Request is not pending");

    if (caller.role === "manager" && requestRow.company_code !== caller.companyCode) {
      return json({ error: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const { data: targetUser, error: targetError } = await supabaseAdmin
      .from("users")
      .select('id, "companyCode", username, role')
      .eq("id", requestRow.target_user_id)
      .single();
    if (targetError) throw new Error(targetError.message);

    if (targetUser.companyCode !== requestRow.company_code) {
      throw new Error("Request/target company mismatch");
    }

    if (caller.role === "manager" && targetUser.role !== "employee") {
      return json({ error: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    if (approve) {
      const reqType = String(requestRow.request_type ?? "");
      const newUsernameRaw = String(body.newUsername ?? "").trim();
      const newPinRaw = String(body.newPin ?? "").trim();

      let nextUsername = targetUser.username;
      if (reqType === "username" || reqType === "both") {
        if (!newUsernameRaw) throw new Error("newUsername is required");
        nextUsername = normalizeUsername(newUsernameRaw);
      }

      let nextPin: string | null = null;
      if (reqType === "pin" || reqType === "both" || reqType === "username") {
        if (!newPinRaw) throw new Error("newPin is required");
        assertPin(newPinRaw, "newPin");
        nextPin = newPinRaw;
      }

      if (nextUsername !== targetUser.username) {
        const { data: conflict, error: conflictError } = await supabaseAdmin
          .from("users")
          .select("id")
          .eq("companyCode", targetUser.companyCode)
          .eq("username", nextUsername)
          .maybeSingle();
        if (conflictError) throw new Error(conflictError.message);
        if (conflict && conflict.id !== targetUser.id) {
          throw new Error("username already in use in this company");
        }
      }

      const authUpdate: { email?: string; password?: string; email_confirm?: boolean } = {};
      if (nextUsername !== targetUser.username) {
        authUpdate.email = internalEmail(targetUser.companyCode, nextUsername);
        authUpdate.email_confirm = true;
      }
      if (nextPin) authUpdate.password = nextPin;

      if (Object.keys(authUpdate).length > 0) {
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
          targetUser.id,
          authUpdate,
        );
        if (authError) throw new Error(authError.message);
      }

      const userUpdate: Record<string, unknown> = { active: true };
      if (nextUsername !== targetUser.username) userUpdate.username = nextUsername;
      if (nextPin) {
        userUpdate.pinHash = await computePinHash(
          targetUser.companyCode,
          nextUsername,
          nextPin,
        );
      }

      const { error: userUpdateError } = await supabaseAdmin
        .from("users")
        .update(userUpdate)
        .eq("id", targetUser.id);
      if (userUpdateError) throw new Error(userUpdateError.message);
    }

    const { error: updateError } = await supabaseAdmin
      .from("credential_reset_requests")
      .update({
        status: approve ? "approved" : "denied",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", requestRow.id);
    if (updateError) throw new Error(updateError.message);

    return json({ ok: true }, { headers: corsHeaders });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400, headers: corsHeaders },
    );
  }
});
