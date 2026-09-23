import { ExaRequestError, exaRequest, isExaConfigured } from "@/lib/exa";
import type { ExaSearchResponse } from "@/lib/exa";
import type { WebSearchResponse } from "@/types";

/**
 * Searches the web through Exa's `/search` endpoint.
 *
 * Sends the recommended request shape — the query plus token-efficient
 * highlights — so each result carries the passages most relevant to the query
 * instead of bare metadata. Result count, freshness and domain filters are left
 * at Exa's defaults on purpose; add them only when a use case requires them.
 */
export async function searchWeb(query: string): Promise<WebSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty-query", error: "Enter something to search for." };
  }

  if (!isExaConfigured()) {
    return { ok: false, reason: "not-configured", error: "Web search is not configured on this server." };
  }

  try {
    const response = await exaRequest<ExaSearchResponse>("/search", {
      query: trimmed,
      type: "auto",
      contents: { highlights: true },
    });

    if (!response) {
      return { ok: false, reason: "not-configured", error: "Web search is not configured on this server." };
    }

    return {
      ok: true,
      query: trimmed,
      results: response.results.map((result) => ({
        id: result.id,
        title: result.title ?? result.url,
        url: result.url,
        publishedDate: result.publishedDate,
        author: result.author,
        highlights: result.highlights ?? [],
      })),
    };
  } catch (error) {
    console.error("Exa search failed", error);
    const status = error instanceof ExaRequestError ? ` (${error.status})` : "";
    return { ok: false, reason: "upstream", error: `Web search failed${status}.` };
  }
}
