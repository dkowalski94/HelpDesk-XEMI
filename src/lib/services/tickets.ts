import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";
import type { TicketPage, TicketSummary } from "@/types";

export const TICKET_PAGE_DEFAULT = 50;
export const TICKET_PAGE_MAX = 100;

/** The `tickets` columns behind a `TicketSummary`; select these and map with `toTicketSummary`. */
export const TICKET_COLUMNS = "id, company_id, status, error_text, created_at";

export function toTicketSummary(row: {
  id: string;
  company_id: string;
  status: TicketSummary["status"];
  error_text: string;
  created_at: string;
}): TicketSummary {
  return {
    id: row.id,
    companyId: row.company_id,
    status: row.status,
    errorText: row.error_text,
    createdAt: row.created_at,
  };
}

/**
 * Lists one page of the tickets the caller is allowed to see.
 *
 * There is deliberately no company filter here: the select runs on the caller's
 * own `authenticated` session, so the rows that come back are exactly the ones
 * the `tickets` SELECT policy permits — a client's own company, every company for
 * staff, nothing for an unassigned account. Adding a filter in application code
 * would hide an RLS regression from `scripts/smoke.mjs` instead of exposing it.
 *
 * `createdBy`, when given, narrows the list to the tickets that account filed
 * ("my tickets" on the client page). It is a view filter inside what RLS already
 * returns, not a security boundary; the default stays unfiltered on purpose.
 *
 * Paged explicitly because PostgREST silently caps a response at `max_rows`: one
 * extra row is fetched to tell whether another page exists, and `id` breaks ties
 * between equal `created_at` values so pages stay stable.
 *
 * Returns `null` when the query fails, so the caller can tell an error from an
 * empty list.
 */
export async function listVisibleTickets(
  supabase: SupabaseClient<Database>,
  { limit, offset, createdBy }: { limit: number; offset: number; createdBy?: string },
): Promise<TicketPage | null> {
  let query = supabase.from("tickets").select(TICKET_COLUMNS);
  if (createdBy !== undefined) {
    query = query.eq("created_by", createdBy);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    console.error("Ticket list failed", error);
    return null;
  }

  return {
    tickets: data.slice(0, limit).map(toTicketSummary),
    nextOffset: data.length > limit ? offset + limit : null,
  };
}
