import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  assertPin,
  computePinHash,
  createAdminClient,
  getEnv,
  internalEmail,
  json,
  normalizeCompanyCode,
  normalizeUsername,
} from "../_shared/admin.ts";

type LoginBody = {
  companyCode?: string;
  username?: string;
  email?: string;
  pin?: string;
};

function normalizeEmail(value: string): string {
  const email = String(value ?? "").trim();
  if (!email || !email.includes("@")) throw new Error("email is required");
  return email.toLowerCase();
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const body = (await req.json()) as LoginBody;
    const pin = String(body.pin ?? "").trim();
    assertPin(pin, "pin");

    let email = "";
    let companyCode = "";
    let username = "";
    if (body.email) {
      email = normalizeEmail(body.email);
    } else {
      companyCode = normalizeCompanyCode(String(body.companyCode ?? ""));
      username = normalizeUsername(String(body.username ?? ""));
      email = internalEmail(companyCode, username).toLowerCase();
    }

    const url = getEnv("SUPABASE_URL");
    const anonKey = getEnv("SUPABASE_ANON_KEY");
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "X-Client-Info": "schedule-manager-edge" } },
    });

    let authResult = await supabase.auth.signInWithPassword({
      email,
      password: pin,
    });

    const supabaseAdmin = createAdminClient();
    let userRow:
      | {
        id: string;
        companyCode: string;
        username: string;
        role: string;
        employeeId: string | null;
        active: boolean;
        force_pin_change: boolean | null;
        pinHash: string | null;
      }
      | null = null;

    if (authResult.error || !authResult.data?.session || !authResult.data.user) {
      if (companyCode && username) {
        let { data: fallbackUser, error: fallbackError } = await supabaseAdmin
          .from("users")
          .select('id, "companyCode", username, role, "employeeId", active, force_pin_change, pinHash')
          .eq("companyCode", companyCode)
          .eq("username", username)
          .maybeSingle();

        if (fallbackError) throw new Error(fallbackError.message);
        if (fallbackUser) {
          const expectedHash = await computePinHash(companyCode, username, pin);
          if (!fallbackUser.pinHash || fallbackUser.pinHash !== expectedHash) {
            return json(
              { error: "invalid_credentials" },
              { status: 401, headers: corsHeaders },
            );
          }

          const { data: authUser, error: authGetError } = await supabaseAdmin.auth.admin
            .getUserById(fallbackUser.id);

          if (authGetError || !authUser?.user) {
            const { data: authCreate, error: authCreateError } = await supabaseAdmin.auth.admin
              .createUser({
                email,
                password: pin,
                email_confirm: true,
              });
            if (authCreateError || !authCreate.user) {
              throw new Error(authCreateError?.message ?? "Failed to create auth user");
            }

            if (authCreate.user.id !== fallbackUser.id) {
              const dependentChecks = await Promise.all([
                supabaseAdmin
                  .from("requests")
                  .select("id", { count: "exact", head: true })
                  .or(`requesterUserId.eq.${fallbackUser.id},targetUserId.eq.${fallbackUser.id},handledBy.eq.${fallbackUser.id}`),
                supabaseAdmin
                  .from("credential_reset_requests")
                  .select("id", { count: "exact", head: true })
                  .or(`requested_by_user_id.eq.${fallbackUser.id},target_user_id.eq.${fallbackUser.id}`),
                supabaseAdmin
                  .from("platform_admin_reset_tokens")
                  .select("id", { count: "exact", head: true })
                  .eq("user_id", fallbackUser.id),
              ]);

              const hasDependencies = dependentChecks.some((check) => (check.count ?? 0) > 0);
              if (hasDependencies) {
                return json(
                  { error: "user_id_mismatch_requires_migration" },
                  { status: 409, headers: corsHeaders },
                );
              }

              const { error: updateIdError } = await supabaseAdmin
                .from("users")
                .update({ id: authCreate.user.id })
                .eq("id", fallbackUser.id);
              if (updateIdError) throw new Error(updateIdError.message);

              fallbackUser = { ...fallbackUser, id: authCreate.user.id };
            }
          } else {
            const authEmail = String(authUser.user.email || email).toLowerCase();
            email = authEmail;
            const { error: authUpdateError } = await supabaseAdmin.auth.admin
              .updateUserById(fallbackUser.id, {
                password: pin,
              });
            if (authUpdateError) throw new Error(authUpdateError.message);
          }

          authResult = await supabase.auth.signInWithPassword({
            email,
            password: pin,
          });

          userRow = fallbackUser;
        }
      }
    }

    if (authResult.error || !authResult.data?.session || !authResult.data.user) {
      return json(
        { error: "invalid_credentials" },
        { status: 401, headers: corsHeaders },
      );
    }

    if (!userRow || userRow.id !== authResult.data.user.id) {
      const { data: fetchedUser, error: userError } = await supabaseAdmin
        .from("users")
        .select('id, "companyCode", username, role, "employeeId", active, force_pin_change')
        .eq("id", authResult.data.user.id)
        .maybeSingle();
      if (userError) throw new Error(userError.message);
      userRow = fetchedUser ?? null;
    }

    if (!userRow) {
      return json(
        { error: "user_mapping_not_found" },
        { status: 400, headers: corsHeaders },
      );
    }

    if (!userRow.active) {
      return json(
        { error: "user_inactive" },
        { status: 403, headers: corsHeaders },
      );
    }

    const { data: companyRow, error: companyError } = await supabaseAdmin
      .from("companies")
      .select('"companyCode", "isDisabled"')
      .eq("companyCode", userRow.companyCode)
      .maybeSingle();

    if (companyError) throw new Error(companyError.message);
    if (companyRow?.isDisabled) {
      return json(
        { error: "company_disabled" },
        { status: 403, headers: corsHeaders },
      );
    }

    return json(
      {
        session: {
          access_token: authResult.data.session.access_token,
          refresh_token: authResult.data.session.refresh_token,
          expires_in: authResult.data.session.expires_in,
          token_type: authResult.data.session.token_type,
          user_id: authResult.data.user.id,
        },
        profile: {
          id: userRow.id,
          companyCode: userRow.companyCode,
          username: userRow.username,
          role: userRow.role,
          employeeId: userRow.employeeId,
          active: userRow.active,
          forcePinChange: Boolean(userRow.force_pin_change),
        },
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
