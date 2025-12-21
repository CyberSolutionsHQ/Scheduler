import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { getBearerToken, getEnv, json } from "../_shared/admin.ts";

type SubmitBody = {
  requestType?: string;
};

const allowedTypes = new Set(["username", "pin", "both"]);

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const body = (await req.json()) as SubmitBody;
    const requestType = String(body.requestType ?? "").trim();
    if (!allowedTypes.has(requestType)) {
      throw new Error("requestType must be username, pin, or both");
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
    if (userRow.role !== "employee") throw new Error("Only employees can submit reset requests");

    const { data: inserted, error: insertError } = await supabase
      .from("credential_reset_requests")
      .insert({
        company_code: userRow.companyCode,
        requested_by_user_id: userRow.id,
        target_user_id: userRow.id,
        request_type: requestType,
        status: "pending",
      })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);

    return json({ ok: true, requestId: inserted.id }, { headers: corsHeaders });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400, headers: corsHeaders },
    );
  }
});
