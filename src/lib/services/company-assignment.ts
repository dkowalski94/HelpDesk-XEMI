import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";
import type { AssignCompanyStatus, PendingAssignmentsResult } from "@/types";

/**
 * Lists the accounts waiting in the `unassigned` company together with the
 * client companies they can be moved to.
 *
 * Runs under the caller's own `authenticated` session: RLS lets staff read every
 * profile and company, and returns nothing extra to anyone else.
 */
export async function listPendingAssignments(supabase: SupabaseClient<Database>): Promise<PendingAssignmentsResult> {
  const [usersResult, companiesResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, created_at, companies!inner ( kind )")
      .eq("companies.kind", "unassigned")
      .order("created_at", { ascending: true }),
    supabase.from("companies").select("id, name").eq("kind", "client").order("name", { ascending: true }),
  ]);

  if (usersResult.error || companiesResult.error) {
    console.error("Pending assignments lookup failed", usersResult.error ?? companiesResult.error);
    return { status: "error" };
  }

  return {
    status: "ok",
    users: usersResult.data.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      createdAt: row.created_at,
    })),
    companies: companiesResult.data,
  };
}

/**
 * Moves an account out of the `unassigned` company into a client company.
 *
 * Must be called with the request-scoped client, never a `service_role` one: the
 * role-immutability trigger allowlists `service_role` and the column-scoped
 * `update (company_id)` grant does not apply to it, so a service-role client
 * would remove every structural guard against rewriting `role`, `email` or `id`.
 *
 * Only `company_id` is written. The update is also filtered on the account still
 * being in the `unassigned` company, so a crafted request cannot move a user
 * between client companies (and hand them another tenant's tickets) — the
 * database permits that, this function deliberately does not.
 */
export async function assignCompany(
  supabase: SupabaseClient<Database>,
  userId: string,
  companyId: string,
): Promise<AssignCompanyStatus> {
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("kind")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) {
    console.error("Company lookup failed", companyError);
    return "error";
  }

  if (company?.kind !== "client") {
    return "invalid-company";
  }

  const { data: unassigned, error: unassignedError } = await supabase
    .from("companies")
    .select("id")
    .eq("kind", "unassigned")
    .maybeSingle();

  if (unassignedError || !unassigned) {
    console.error("Unassigned company lookup failed", unassignedError);
    return "error";
  }

  // RLS reports a denied or non-matching update as success with zero rows, so the
  // affected rows are requested back and anything but exactly one is a failure.
  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({ company_id: companyId })
    .eq("id", userId)
    .eq("company_id", unassigned.id)
    .select("id");

  if (updateError) {
    console.error("Company assignment failed", updateError);
    return "error";
  }

  return updated.length === 1 ? "assigned" : "not-updated";
}
