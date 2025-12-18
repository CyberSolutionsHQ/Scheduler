import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  assertCallerActive,
  assertPin,
  computePinHash,
  createAdminClient,
  getCallerContext,
  internalEmail,
  json,
  normalizeCompanyCode,
  normalizeUsername,
} from "../_shared/admin.ts";

function assertUuid(value: string, field: string): void {
  const v = (value ?? "").trim();
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(v)) throw new Error(`${field} must be a UUID`);
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const supabaseAdmin = createAdminClient();
    const caller = await getCallerContext(supabaseAdmin, req);
    assertCallerActive(caller);
    if (caller.role !== "manager") {
      return json({ error: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const body = await req.json();
    const companyCode = normalizeCompanyCode(String(body.companyCode ?? ""));
    if (companyCode !== caller.companyCode) {
      return json({ error: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const { data: companyRow, error: companyError } = await supabaseAdmin
      .from("companies")
      .select('"isDisabled"')
      .eq("companyCode", companyCode)
      .maybeSingle();
    if (companyError) throw new Error(companyError.message);
    if (!companyRow) throw new Error("Company not found");
    if (companyRow.isDisabled) throw new Error("Company is disabled");

    const employeeId = String(body.employeeId ?? "").trim();
    assertUuid(employeeId, "employeeId");

    const username = normalizeUsername(String(body.username ?? ""));
    const pin = String(body.pin ?? "").trim();
    assertPin(pin, "pin");

    const { data: employeeRow, error: employeeError } = await supabaseAdmin
      .from("employees")
      .select('id, "companyCode"')
      .eq("id", employeeId)
      .eq("companyCode", companyCode)
      .maybeSingle();

    if (employeeError) throw new Error(employeeError.message);
    if (!employeeRow) throw new Error("Employee not found in company");

    const { data: existingByUsername, error: byUsernameError } =
      await supabaseAdmin
        .from("users")
        .select('id, "employeeId", role, username')
        .eq("companyCode", companyCode)
        .eq("username", username)
        .maybeSingle();

    if (byUsernameError) throw new Error(byUsernameError.message);

    const { data: existingByEmployee, error: byEmployeeError } =
      await supabaseAdmin
        .from("users")
        .select("id, username, role")
        .eq("companyCode", companyCode)
        .eq("role", "employee")
        .eq("employeeId", employeeId)
        .maybeSingle();

    if (byEmployeeError) throw new Error(byEmployeeError.message);

    if (
      existingByUsername && existingByEmployee &&
      existingByUsername.id !== existingByEmployee.id
    ) {
      throw new Error("username already in use in this company");
    }
    if (existingByUsername && !existingByEmployee) {
      throw new Error("username already in use in this company");
    }

    const pinHash = await computePinHash(companyCode, username, pin);
    const email = internalEmail(companyCode, username);

    if (!existingByEmployee) {
      const { data: authCreate, error: authError } = await supabaseAdmin.auth
        .admin.createUser({
          email,
          password: pin,
          email_confirm: true,
        });
      if (authError || !authCreate.user) {
        throw new Error(authError?.message ?? "Failed to create auth user");
      }

      const newUserId = authCreate.user.id;
      const { error: insertError } = await supabaseAdmin.from("users").insert({
        id: newUserId,
        companyCode,
        username,
        pinHash,
        role: "employee",
        employeeId,
        active: true,
      });

      if (insertError) {
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        throw new Error(insertError.message);
      }

      return json({ username, pin }, { headers: corsHeaders });
    }

    // Update existing employee login (username and/or pin)
    const existingUserId = existingByEmployee.id;
    const { data: authUser, error: authGetError } = await supabaseAdmin.auth
      .admin.getUserById(existingUserId);
    if (authGetError || !authUser.user) {
      throw new Error(authGetError?.message ?? "Auth user not found");
    }

    const updatePayload: { email?: string; password?: string; email_confirm?: boolean } =
      { password: pin };
    if ((authUser.user.email ?? "").toLowerCase() !== email.toLowerCase()) {
      updatePayload.email = email;
      updatePayload.email_confirm = true;
    }

    const { error: authUpdateError } = await supabaseAdmin.auth.admin
      .updateUserById(existingUserId, updatePayload);
    if (authUpdateError) throw new Error(authUpdateError.message);

    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ username, pinHash, active: true })
      .eq("id", existingUserId);
    if (updateError) throw new Error(updateError.message);

    return json({ username, pin }, { headers: corsHeaders });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400, headers: corsHeaders },
    );
  }
});
