import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";
import type { TicketSummary } from "@/types";

/**
 * Lists every ticket the caller is allowed to see.
 *
 * There is deliberately no company filter here: the select runs on the caller's
 * own `authenticated` session, so the rows that come back are exactly the ones
 * the `tickets` SELECT policy permits — a client's own company, every company for
 * staff, nothing for an unassigned account. Adding a filter in application code
 * would hide an RLS regression from `scripts/smoke.mjs` instead of exposing it.
 *
 * Returns `null` when the query fails, so the caller can tell an error from an
 * empty list.
 */
export async function listVisibleTickets(supabase: SupabaseClient<Database>): Promise<TicketSummary[] | null> {
  const { data, error } = await supabase
    .from("tickets")
    .select("id, company_id, status, error_text, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Ticket list failed", error);
    return null;
  }

  return data.map((row) => ({
    id: row.id,
    companyId: row.company_id,
    status: row.status,
    errorText: row.error_text,
    createdAt: row.created_at,
  }));
}
