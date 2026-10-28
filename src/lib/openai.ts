import { OPENAI_API_KEY } from "astro:env/server";

const EMBEDDINGS_ENDPOINT = "https://api.openai.com/v1/embeddings";
const REQUEST_TIMEOUT_MS = 8000;

/**
 * The model and dimension the ERP ingest side embedded every stored entry with
 * (`scripts/ingest/embeddings.mjs`, column `extensions.vector(1536)`). Change both
 * sides or neither: a query vector from another model or dimension matches nothing.
 */
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

interface OpenAIEmbeddingsResponse {
  data?: { embedding?: unknown }[];
}

export function isOpenAIConfigured() {
  return Boolean(OPENAI_API_KEY);
}

/**
 * Embeds one text with the OpenAI embeddings API, keyed by `OPENAI_API_KEY` from
 * `astro:env/server`.
 *
 * Uses `fetch` directly rather than the OpenAI SDK, so nothing
 * Node-specific reaches the workerd runtime. No retries: a paste is answered while
 * the user waits, and a failed search falls back to filing a ticket.
 *
 * Returns `null` when no API key is configured, matching `createClient()` in
 * `@/lib/supabase` — callers degrade instead of throwing. Throws `OpenAIRequestError`
 * on a non-ok response or a malformed vector; a timeout or network failure throws
 * whatever `fetch` throws.
 */
export async function embedText(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) {
    return null;
  }

  const response = await fetch(EMBEDDINGS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text, encoding_format: "float" }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new OpenAIRequestError(response.status, await errorCode(response));
  }

  const body = (await response.json()) as OpenAIEmbeddingsResponse;
  const embedding = body.data?.[0]?.embedding;
  if (
    !Array.isArray(embedding) ||
    embedding.length !== EMBEDDING_DIMENSIONS ||
    !embedding.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    throw new OpenAIRequestError(response.status, `Expected ${EMBEDDING_DIMENSIONS} finite numbers in the embedding.`);
  }

  return embedding as number[];
}

/**
 * Only OpenAI's error `code`/`type`, never the message: a 401 message echoes a masked
 * fragment of the key, and `detail` ends up in Worker logs.
 */
async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; type?: unknown } };
    const code = body.error?.code ?? body.error?.type;
    return typeof code === "string" ? code : "unknown";
  } catch {
    return "unknown";
  }
}

export class OpenAIRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`OpenAI embeddings responded ${status}`);
    this.name = "OpenAIRequestError";
  }
}
