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

type UpdateBody = {
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
    if (caller.role !== "platform_admin") {
      return json({ error: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const body = (await req.json()) as UpdateBody;
    const newUsernameRaw = String(body.newUsername ?? "").trim();
    const newPinRaw = String(body.newPin ?? "").trim();

    if (!newUsernameRaw && !newPinRaw) {
      throw new Error("newUsername or newPin is required");
    }

    const { data: currentUser, error: currentError } = await supabaseAdmin
      .from("users")
      .select('id, "companyCode", username')
      .eq("id", caller.authUserId)
      .single();
    if (currentError || !currentUser) throw new Error("User mapping not found");

    const companyCode = currentUser.companyCode;
    const currentUsername = currentUser.username;
    const nextUsername = newUsernameRaw
      ? normalizeUsername(newUsernameRaw)
      : currentUsername;

    let nextPin: string | null = null;
    if (newPinRaw) {
      assertPin(newPinRaw, "newPin");
      nextPin = newPinRaw;
    }

    if (nextUsername !== currentUsername && !nextPin) {
      throw new Error("newPin is required when changing username");
    }

    if (nextUsername !== currentUsername) {
      const { data: conflict, error: conflictError } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("companyCode", companyCode)
        .eq("username", nextUsername)
        .maybeSingle();
      if (conflictError) throw new Error(conflictError.message);
      if (conflict && conflict.id !== currentUser.id) {
        throw new Error("username already in use in this company");
      }
    }

    const authUpdate: {
      email?: string;
      password?: string;
      email_confirm?: boolean;
    } = {};

    if (nextUsername !== currentUsername) {
      authUpdate.email = internalEmail(companyCode, nextUsername);
      authUpdate.email_confirm = true;
    }

    if (nextPin) authUpdate.password = nextPin;

    if (Object.keys(authUpdate).length > 0) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        currentUser.id,
        authUpdate,
      );
      if (authError) throw new Error(authError.message);
    }

    const userUpdate: Record<string, unknown> = { active: true };
    if (nextUsername !== currentUsername) userUpdate.username = nextUsername;
    if (nextPin) {
      userUpdate.pinHash = await computePinHash(companyCode, nextUsername, nextPin);
    }

    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update(userUpdate)
      .eq("id", currentUser.id);
    if (updateError) throw new Error(updateError.message);

    return json(
      { ok: true, username: nextUsername, companyCode },
      { headers: corsHeaders },
    );
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400, headers: corsHeaders },
    );
  }
});
