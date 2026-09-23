import { EXA_API_KEY } from "astro:env/server";

const EXA_API_BASE = "https://api.exa.ai";

/** Shape of a single result in an Exa `/search` response. */
export interface ExaSearchResult {
  id: string;
  url: string;
  title: string | null;
  publishedDate?: string;
  author?: string;
  highlights?: string[];
}

export interface ExaSearchResponse {
  requestId: string;
  results: ExaSearchResult[];
}

export function isExaConfigured() {
  return Boolean(EXA_API_KEY);
}

/**
 * Calls an Exa endpoint with the API key from `astro:env/server`.
 *
 * Uses `fetch` directly rather than the `exa-js` SDK: the SDK depends on
 * `cross-fetch`, which `require`s `node-fetch` and fails under the Cloudflare
 * workerd runtime this app is deployed to.
 *
 * Returns `null` when no API key is configured, matching `createClient()` in
 * `@/lib/supabase` — callers degrade instead of throwing.
 */
export async function exaRequest<T>(endpoint: string, body: unknown): Promise<T | null> {
  if (!EXA_API_KEY) {
    return null;
  }

  const response = await fetch(`${EXA_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": EXA_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ExaRequestError(endpoint, response.status, await response.text());
  }

  return (await response.json()) as T;
}

export class ExaRequestError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Exa ${endpoint} responded ${status}`);
    this.name = "ExaRequestError";
  }
}
