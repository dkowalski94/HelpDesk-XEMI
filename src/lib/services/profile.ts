import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyKind, SessionProfile, UserRole } from "@/types";

/** The row shape the select below asks PostgREST for, with `companies` embedded. */
interface ProfileWithCompanyRow {
  id: string;
  email: string;
  role: UserRole;
  company_id: string;
  companies: { name: string; kind: CompanyKind } | null;
}

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
 * Returns `null` when the user has no profile row yet, or when the company it
 * points at is not readable: either way there is no tenancy to act on, and the
 * caller must treat the user as unresolved rather than guess one.
 */
export async function getSessionProfile(supabase: SupabaseClient, userId: string): Promise<SessionProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, company_id, companies ( name, kind )")
    .eq("id", userId)
    .maybeSingle<ProfileWithCompanyRow>();

  if (error) {
    console.error("Profile lookup failed", error);
    return null;
  }

  if (!data?.companies) {
    return null;
  }

  return {
    id: data.id,
    email: data.email,
    role: data.role,
    companyId: data.company_id,
    companyName: data.companies.name,
    companyKind: data.companies.kind,
  };
}
