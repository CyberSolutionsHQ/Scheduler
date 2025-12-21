import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  assertPin,
  getBearerToken,
  getEnv,
  json,
  normalizeUsername,
} from "../_shared/admin.ts";

type SubmitBody = {
  proposedUsername?: string;
  proposedPin?: string;
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const body = (await req.json()) as SubmitBody;
    const proposedUsernameRaw = String(body.proposedUsername ?? "").trim();
    const proposedPinRaw = String(body.proposedPin ?? "").trim();

    if (!proposedUsernameRaw && !proposedPinRaw) {
      throw new Error("proposedUsername or proposedPin is required");
    }

    let proposedUsername = "";
    if (proposedUsernameRaw) {
      proposedUsername = normalizeUsername(proposedUsernameRaw);
    }

    let proposedPin = "";
    if (proposedPinRaw) {
      assertPin(proposedPinRaw, "proposedPin");
      proposedPin = proposedPinRaw;
    }

    const url = getEnv("SUPABASE_URL");
    const anonKey = getEnv("SUPABASE_ANON_KEY");
    const token = getBearerToken(req);

    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: `Bearer ${token}`, "X-Client-Info": "schedule-manager-edge" },
      },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) throw new Error("Invalid auth token");

    const { data: userRow, error: userError } = await supabase
      .from("users")
      .select('id, "companyCode", role, active')
      .eq("id", authData.user.id)
      .single();
    if (userError || !userRow) throw new Error("User mapping not found");
    if (!userRow.active) throw new Error("User is inactive");

    let requestType = "";
    if (userRow.role === "employee") requestType = "employee_change_credentials";
    else if (userRow.role === "manager") requestType = "manager_change_credentials";
    else if (userRow.role === "platform_admin") {
      throw new Error("Platform admins update credentials directly");
    } else {
      throw new Error("Unsupported role");
    }

    const { data: inserted, error: insertError } = await supabase
      .from("requests")
      .insert({
        companyCode: userRow.companyCode,
        type: requestType,
        status: "pending",
        requesterUserId: userRow.id,
        targetUserId: userRow.id,
        proposedUsername,
        proposedPin,
      })
      .select("id")
      .single();

    if (insertError) throw new Error(insertError.message);

    return json(
      { ok: true, requestId: inserted.id, type: requestType },
      { headers: corsHeaders },
    );
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400, headers: corsHeaders },
    );
  }
});
