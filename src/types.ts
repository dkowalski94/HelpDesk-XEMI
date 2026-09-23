/** A single web result returned by the Exa-backed web search tool. */
export interface WebSearchResult {
  id: string;
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  /** Query-relevant passages extracted from the page by Exa. */
  highlights: string[];
}

export interface WebSearchSuccess {
  ok: true;
  query: string;
  results: WebSearchResult[];
}

/** Why a web search could not be answered — the API route maps this to a status code. */
export type WebSearchFailureReason = "unauthorized" | "empty-query" | "not-configured" | "upstream";

export interface WebSearchFailure {
  ok: false;
  reason: WebSearchFailureReason;
  error: string;
}

export type WebSearchResponse = WebSearchSuccess | WebSearchFailure;
