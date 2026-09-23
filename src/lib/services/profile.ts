import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";
import type { SessionProfileResult } from "@/types";

/**
 * Resolves who the signed-in user is acting as: their role plus the company
 * that owns them.
 *
 * One select with the company embedded, so the middleware pays a single round
 * trip per request and never has to know a Supabase query shape. It runs under
 * the caller's own `authenticated` role — RLS already lets a user read their own
 * `profiles` row and their own `companies` row, so no service-role client is
 * needed or wanted here.
 *
 * Returns a discriminated result rather than a bare `null`: a failed lookup and
 * an absent profile lead to different things being said to the user, and the
 * caller cannot tell them apart once both collapse into the same value.
 */
export async function getSessionProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<SessionProfileResult> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, company_id, companies ( name, kind )")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Profile lookup failed", error);
    return { status: "error" };
  }

  if (!data?.companies) {
    return { status: "missing" };
  }

  return {
    status: "ok",
    profile: {
      id: data.id,
      email: data.email,
      role: data.role,
      companyId: data.company_id,
      companyName: data.companies.name,
      companyKind: data.companies.kind,
    },
  };
}
