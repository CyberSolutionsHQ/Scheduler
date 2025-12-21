import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  assertPin,
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
    if (body.email) {
      email = normalizeEmail(body.email);
    } else {
      const companyCode = normalizeCompanyCode(String(body.companyCode ?? ""));
      const username = normalizeUsername(String(body.username ?? ""));
      email = internalEmail(companyCode, username).toLowerCase();
    }

    const url = getEnv("SUPABASE_URL");
    const anonKey = getEnv("SUPABASE_ANON_KEY");
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "X-Client-Info": "schedule-manager-edge" } },
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: pin,
    });

    if (error || !data?.session || !data.user) {
      return json(
        { error: "invalid_credentials" },
        { status: 401, headers: corsHeaders },
      );
    }

    const supabaseAdmin = createAdminClient();
    const { data: userRow, error: userError } = await supabaseAdmin
      .from("users")
      .select('id, "companyCode", username, role, "employeeId", active, force_pin_change')
      .eq("id", data.user.id)
      .maybeSingle();

    if (userError || !userRow) {
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
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_in: data.session.expires_in,
          token_type: data.session.token_type,
          user_id: data.user.id,
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
