import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";
import { ERROR_TEXT_MAX_LENGTH } from "@/lib/error-text";
import { embedText, OpenAIRequestError } from "@/lib/openai";
import { TICKET_COLUMNS, toTicketSummary } from "@/lib/services/tickets";
import type { ErrorResolutionResponse, KnowledgeMatch } from "@/types";

/**
 * The single calibration knob: a knowledge base entry counts as a match at this
 * cosine similarity or above. 0.5 is a starting point, to be calibrated on real
 * queries against the logged best similarity of each search — it is applied here,
 * not in SQL, so changing it needs no migration.
 *
 * Recorded 2026-10-13 against Instrukcja-xemi-sprzedaz.pdf: matched 0.6449, 0.5818,
 * 0.5391, 0.5328; a real error explained in the PDF missed at 0.4629; unrelated text
 * 0.4368, 0.4123. Too few samples and too thin a gap to move the knob — calibration
 * deferred until better documentation is ingested.
 */
export const MATCH_THRESHOLD = 0.5;

/** How many entries a search ranks and, at most, shows. */
export const MATCH_COUNT = 3;

type MatchRow = Omit<Database["public"]["Functions"]["match_knowledge_base"]["Returns"][number], "cause" | "steps"> & {
  cause: string | null;
  steps: string | null;
};

type SearchResult = { status: "ok"; matches: KnowledgeMatch[] } | { status: "unavailable" };

/**
 * Ranks the knowledge base against the text. Never throws: every way the search can
 * fail — no key, an OpenAI error, a timeout, an RPC error — is "unavailable", and the
 * caller files a ticket instead.
 */
async function searchKnowledgeBase(supabase: SupabaseClient<Database>, text: string): Promise<SearchResult> {
  let vector: number[] | null;
  try {
    vector = await embedText(text);
  } catch (error) {
    const status = error instanceof OpenAIRequestError ? ` (${error.status})` : "";
    console.error(`Error resolution: embedding failed${status}`, error);
    return { status: "unavailable" };
  }

  if (!vector) {
    console.warn("Error resolution: OPENAI_API_KEY is not configured, search skipped");
    return { status: "unavailable" };
  }

  // Threshold 0 in SQL: every ranked row comes back, so the best similarity of a
  // near miss is still logged below.
  const { data, error } = await supabase.rpc("match_knowledge_base", {
    p_query_embedding: JSON.stringify(vector),
    p_match_threshold: 0,
    p_match_count: MATCH_COUNT,
  });

  if (error) {
    console.error("Error resolution: match_knowledge_base failed", error);
    return { status: "unavailable" };
  }

  // Widened on purpose: `supabase gen types` marks every `returns table` column
  // non-null, but `cause` and `steps` are nullable (`cause` is always null for erp_doc).
  const rows: MatchRow[] = data;
  const best = rows.length > 0 ? Math.max(...rows.map((row) => row.similarity)) : null;
  console.log(
    `Error resolution: best similarity ${best === null ? "none" : best.toFixed(4)} (threshold ${MATCH_THRESHOLD})`,
  );

  return {
    status: "ok",
    matches: rows
      .filter((row) => row.similarity >= MATCH_THRESHOLD)
      .map((row) => ({
        id: row.id,
        source: row.source,
        errorText: row.error_text,
        cause: row.cause,
        steps: row.steps,
        similarity: row.similarity,
      })),
  };
}

/**
 * Resolves one pasted error end to end: validate, search the knowledge base, and
 * only when nothing matches, return the caller's open ticket for the same text or
 * file a new one. Never throws — every outcome is a response the route can send.
 */
export async function resolveError(
  supabase: SupabaseClient<Database>,
  { userId, companyId }: { userId: string; companyId: string },
  rawText: string,
): Promise<ErrorResolutionResponse> {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty-text", error: "Wklej treść błędu." };
  }
  if (trimmed.length > ERROR_TEXT_MAX_LENGTH) {
    return {
      ok: false,
      reason: "too-long",
      error: `Treść błędu może mieć najwyżej ${ERROR_TEXT_MAX_LENGTH} znaków.`,
    };
  }

  const search = await searchKnowledgeBase(supabase, trimmed);
  if (search.status === "ok" && search.matches.length > 0) {
    return { ok: true, outcome: "matched", matches: search.matches };
  }
  const searchUnavailable = search.status === "unavailable";

  // A lookup error is treated as "not found": a duplicate ticket beats a lost report.
  const { data: existing, error: lookupError } = await supabase
    .from("tickets")
    .select(TICKET_COLUMNS)
    .eq("created_by", userId)
    .eq("status", "todo")
    .eq("error_text", trimmed)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    console.error("Error resolution: open ticket lookup failed", lookupError);
  } else if (existing) {
    return { ok: true, outcome: "already-reported", ticket: toTicketSummary(existing), searchUnavailable };
  }

  const { data: created, error: insertError } = await supabase
    .from("tickets")
    .insert({ company_id: companyId, created_by: userId, error_text: trimmed })
    .select(TICKET_COLUMNS)
    .single();

  if (insertError) {
    console.error("Error resolution: ticket insert failed", insertError);
    return { ok: false, reason: "error", error: "Nie udało się zgłosić błędu. Spróbuj ponownie." };
  }

  return { ok: true, outcome: "ticket-created", ticket: toTicketSummary(created), searchUnavailable };
}
