import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";
import { embedText, OpenAIRequestError } from "@/lib/openai";
import { sanitizeErrorText, sanitizeResolutionText } from "@/lib/sanitize-error-text";
import { TICKET_COLUMNS, toTicketSummary } from "@/lib/services/tickets";
import type { BackfillEmbeddingsResult, ResolveTicketOutcome, StaffQueueResult } from "@/types";

/** Tickets per page of the staff queue. */
export const STAFF_QUEUE_PAGE_SIZE = 50;

/** Upper bound on the cause and on the steps, after trim. */
export const RESOLUTION_TEXT_MAX_LENGTH = 4000;

/** Knowledge base entries one "Przelicz" click embeds at most. */
export const BACKFILL_BATCH = 20;

const QUEUE_COLUMNS = `${TICKET_COLUMNS}, user_comment, companies ( name )` as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Embeds one sanitized text. Never throws: a missing key or an OpenAI failure is
 * `null`, logged, and the caller carries on without a vector.
 */
async function tryEmbed(text: string, context: string): Promise<number[] | null> {
  try {
    const vector = await embedText(text);
    if (!vector) {
      console.warn(`${context}: OPENAI_API_KEY is not configured, embedding skipped`);
    }
    return vector;
  } catch (error) {
    const status = error instanceof OpenAIRequestError ? ` (${error.status})` : "";
    console.error(`${context}: embedding failed${status}`, error);
    return null;
  }
}

/**
 * Lists one page of `todo` tickets from every client company, oldest first, with the
 * sanitized text each would put in the knowledge base.
 *
 * Runs under the caller's own session: RLS lets staff read every ticket and company,
 * so this is only ever called for staff. Paged like `listVisibleTickets` — one extra
 * row tells whether another page exists, and `id` breaks `created_at` ties.
 */
export async function listTodoQueue(
  supabase: SupabaseClient<Database>,
  { offset }: { offset: number },
): Promise<StaffQueueResult> {
  const { data, error } = await supabase
    .from("tickets")
    .select(QUEUE_COLUMNS)
    .eq("status", "todo")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + STAFF_QUEUE_PAGE_SIZE);

  if (error) {
    console.error("Staff queue lookup failed", error);
    return { status: "error" };
  }

  return {
    status: "ok",
    tickets: data.slice(0, STAFF_QUEUE_PAGE_SIZE).map((row) => {
      const companyName = (row.companies as { name: string } | null)?.name ?? null;
      return {
        ...toTicketSummary(row),
        companyName,
        userComment: row.user_comment,
        kbPreview: sanitizeErrorText(row.error_text, companyName),
      };
    }),
    nextOffset: data.length > STAFF_QUEUE_PAGE_SIZE ? offset + STAFF_QUEUE_PAGE_SIZE : null,
  };
}

/**
 * Resolves one ticket and feeds the knowledge base through `resolve_ticket()`.
 *
 * The knowledge base error text is sanitized here from the ticket row as stored — never
 * from form input — and the embedding is computed from that sanitized text, because
 * it is the text that gets matched. The entry's cause and steps are sanitized copies too;
 * the ticket keeps them as written, since only its own company reads it. Without a vector the resolution is still saved
 * (`resolved-no-embedding`) and a later backfill fills it.
 *
 * Input limits are checked before any OpenAI call. The database function owns the
 * resolver's identity, the company and atomicity; a ticket seen as resolved here is
 * answered without spending an embedding, and the function stays the authority for a
 * race between two staff members. Never throws.
 */
export async function resolveTicket(
  supabase: SupabaseClient<Database>,
  { ticketId, cause, steps }: { ticketId: string; cause: string; steps: string },
): Promise<ResolveTicketOutcome> {
  const trimmedSteps = steps.trim();
  const trimmedCause = cause.trim();
  if (
    !UUID_PATTERN.test(ticketId) ||
    !trimmedSteps ||
    trimmedSteps.length > RESOLUTION_TEXT_MAX_LENGTH ||
    trimmedCause.length > RESOLUTION_TEXT_MAX_LENGTH
  ) {
    return "invalid";
  }

  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .select("status, error_text, companies ( name )")
    .eq("id", ticketId)
    .maybeSingle();

  if (ticketError) {
    console.error("Ticket resolution: ticket lookup failed", ticketError);
    return "error";
  }
  if (!ticket) {
    return "not-found";
  }
  if (ticket.status !== "todo") {
    return "already-resolved";
  }

  const companyName = (ticket.companies as { name: string } | null)?.name ?? null;
  const sanitized = sanitizeErrorText(ticket.error_text, companyName);
  const vector = await tryEmbed(sanitized, "Ticket resolution");

  // The optional arguments are omitted, never passed as null: see the migration's
  // signature and the generated `p_cause?` / `p_kb_cause?` / `p_embedding?` types.
  const { data, error } = await supabase.rpc("resolve_ticket", {
    p_ticket_id: ticketId,
    p_steps: trimmedSteps,
    p_kb_error_text: sanitized,
    p_kb_steps: sanitizeResolutionText(trimmedSteps, companyName),
    ...(trimmedCause ? { p_cause: trimmedCause, p_kb_cause: sanitizeResolutionText(trimmedCause, companyName) } : {}),
    ...(vector ? { p_embedding: JSON.stringify(vector) } : {}),
  });

  if (error) {
    console.error("Ticket resolution: resolve_ticket failed", error);
    return error.code === "22023" ? "invalid" : "error";
  }

  switch (data) {
    case "resolved":
      return vector ? "resolved" : "resolved-no-embedding";
    case "already-resolved":
    case "not-found":
      return data;
    default:
      console.error(`Ticket resolution: unexpected resolve_ticket result ${JSON.stringify(data)}`);
      return "error";
  }
}

/**
 * Counts the ticket-derived knowledge base entries still waiting for an embedding.
 * Returns `null` when the count fails.
 */
export async function countMissingEmbeddings(supabase: SupabaseClient<Database>): Promise<number | null> {
  const { count, error } = await supabase
    .from("knowledge_base_entries")
    .select("id", { count: "exact", head: true })
    .eq("source", "ticket")
    .is("embedding", null);

  if (error) {
    console.error("Missing embeddings count failed", error);
    return null;
  }

  return count ?? 0;
}

/**
 * Embeds up to `BACKFILL_BATCH` ticket entries that were saved without a vector.
 *
 * The stored `error_text` is already sanitized, so it is embedded as is. Each write
 * is filtered on the embedding still being null, so two concurrent backfills never
 * overwrite each other; the staff UPDATE policy limits it to `source = 'ticket'`.
 * Stops at the first embedding failure — the next click retries. Never throws.
 */
export async function backfillEmbeddings(supabase: SupabaseClient<Database>): Promise<BackfillEmbeddingsResult> {
  const { data: rows, error } = await supabase
    .from("knowledge_base_entries")
    .select("id, error_text")
    .eq("source", "ticket")
    .is("embedding", null)
    .order("created_at", { ascending: true })
    .limit(BACKFILL_BATCH);

  if (error) {
    console.error("Embedding backfill: lookup failed", error);
    return { status: "error" };
  }

  let filled = 0;
  let embeddingFailed = false;
  for (const row of rows) {
    const vector = await tryEmbed(row.error_text, "Embedding backfill");
    if (!vector) {
      embeddingFailed = true;
      break;
    }

    const { data: updated, error: updateError } = await supabase
      .from("knowledge_base_entries")
      .update({ embedding: JSON.stringify(vector) })
      .eq("id", row.id)
      .is("embedding", null)
      .select("id");

    if (updateError) {
      console.error("Embedding backfill: update failed", updateError);
      return { status: "error" };
    }
    // Zero rows means a concurrent backfill filled this entry first.
    filled += updated.length;
  }

  if (embeddingFailed && filled === 0) {
    return { status: "unavailable" };
  }

  return { status: "ok", filled, remaining: await countMissingEmbeddings(supabase) };
}
