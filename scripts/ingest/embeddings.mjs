// Turns fragment texts into embeddings with OpenAI, over plain `fetch` (no SDK).
// The model and dimension are shared with the database column (extensions.vector(1536)) and
// with S-01's query side: change one and every stored vector becomes unmatchable.

import { setTimeout as sleep } from "node:timers/promises";
import { IngestError, MSG } from "./messages.mjs";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

const ENDPOINT = "https://api.openai.com/v1/embeddings";
/** Inputs per request, at most. */
const BATCH_SIZE = 64;
/**
 * Estimated tokens per request, at most. A request larger than the account's tokens-per-minute
 * limit fails with 429 on every retry: the lowest OpenAI tier allows 40 000 TPM, and 64 full
 * fragments are ~43 000 tokens. Smaller requests fit the limit, and a 429 between them is paced
 * by `retry-after`.
 */
const BATCH_TOKENS = 8000;
/** Deliberately pessimistic for Polish text (real ratio is ~4.5 characters per token). */
const CHARS_PER_TOKEN = 3;
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60_000;
/** Per attempt, body included. A batch normally answers in 1–3 s; a stalled connection is retried. */
const REQUEST_TIMEOUT_MS = 60_000;

/** `retry-after-ms` / `retry-after` (seconds or an HTTP date) in milliseconds, or undefined. */
function retryAfterMs(response) {
  const ms = Number(response.headers.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function backoffMs(attempt, hintMs) {
  const exponential = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 250;
  return Math.min(MAX_DELAY_MS, Math.max(exponential, hintMs ?? 0));
}

async function readErrorBody(response) {
  try {
    const body = await response.json();
    return { code: body?.error?.code ?? body?.error?.type ?? "", message: body?.error?.message ?? "" };
  } catch {
    return { code: "", message: "" };
  }
}

/** One request for one batch, retried on 429 / 5xx / network failures. */
async function requestBatch(apiKey, inputs, onRetry) {
  for (let attempt = 1; ; attempt++) {
    let response;
    let text;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs, encoding_format: "float" }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // Read inside the try: a connection dropped mid-body is a network failure, retried like one.
      if (response.ok) text = await response.text();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) {
        const cause = error instanceof Error ? error.cause : undefined;
        const detail =
          error?.name === "TimeoutError"
            ? "ETIMEDOUT"
            : cause && typeof cause === "object" && "code" in cause
              ? String(cause.code)
              : undefined;
        throw new IngestError("OPENAI_NETWORK", detail, { cause: error });
      }
      const delay = backoffMs(attempt);
      onRetry?.(Math.ceil(delay / 1000), attempt + 1, MAX_ATTEMPTS);
      await sleep(delay);
      continue;
    }

    if (response.ok) {
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new IngestError("OPENAI_BAD_RESPONSE", MSG.badJson, { cause: error });
      }
    }

    const { code, message } = await readErrorBody(response);
    if (response.status === 401) throw new IngestError("OPENAI_KEY_INVALID", undefined, { cause: { code, message } });
    if (response.status === 429 && code === "insufficient_quota")
      throw new IngestError("OPENAI_QUOTA", undefined, { cause: { code, message } });

    // "Request too large … on tokens per min" is a 429 that waiting never fixes.
    const tooLarge = response.status === 429 && message.startsWith("Request too large");
    const retryable = (response.status === 429 && !tooLarge) || response.status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS)
      throw new IngestError("OPENAI_FAILED", `HTTP ${response.status}${message ? ` — ${message}` : ""}`, {
        cause: { code, message },
      });

    const delay = backoffMs(attempt, retryAfterMs(response));
    onRetry?.(Math.ceil(delay / 1000), attempt + 1, MAX_ATTEMPTS);
    await sleep(delay);
  }
}

/** Checks the response shape and returns the vectors in input order. */
function vectorsFrom(body, expected) {
  const items = Array.isArray(body?.data) ? body.data : undefined;
  if (!items || items.length !== expected)
    throw new IngestError("OPENAI_BAD_RESPONSE", MSG.vectorCount(expected, items?.length ?? 0));
  const vectors = new Array(expected);
  for (const item of items) {
    const { index, embedding } = item ?? {};
    if (!Number.isInteger(index) || index < 0 || index >= expected || vectors[index] !== undefined)
      throw new IngestError("OPENAI_BAD_RESPONSE", MSG.vectorOrder);
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS)
      throw new IngestError(
        "OPENAI_BAD_RESPONSE",
        MSG.vectorDimensions(Array.isArray(embedding) ? embedding.length : 0, EMBEDDING_DIMENSIONS),
      );
    if (!embedding.every((value) => typeof value === "number" && Number.isFinite(value)))
      throw new IngestError("OPENAI_BAD_RESPONSE", MSG.vectorValues);
    vectors[index] = embedding;
  }
  return vectors;
}

/** Consecutive batches of at most BATCH_SIZE texts and ~BATCH_TOKENS estimated tokens each. */
function batchesOf(texts) {
  const batches = [];
  let batch = [];
  let tokens = 0;
  for (const text of texts) {
    const estimate = Math.ceil(text.length / CHARS_PER_TOKEN);
    if (batch.length > 0 && (batch.length >= BATCH_SIZE || tokens + estimate > BATCH_TOKENS)) {
      batches.push(batch);
      batch = [];
      tokens = 0;
    }
    batch.push(text);
    tokens += estimate;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/**
 * Embeds every text in order, in requests small enough for the lowest rate-limit tier.
 *
 * @param {string} apiKey OpenAI API key
 * @param {string[]} texts fragment texts
 * @param {{ onProgress?: (done: number, total: number) => void,
 *           onRetry?: (seconds: number, attempt: number, maxAttempts: number) => void }} [hooks]
 * @returns {Promise<number[][]>} one 1536-dimension vector per text, same order
 * @throws {IngestError} OPENAI_KEY_INVALID, OPENAI_QUOTA, OPENAI_NETWORK, OPENAI_FAILED, OPENAI_BAD_RESPONSE
 */
export async function embedTexts(apiKey, texts, { onProgress, onRetry } = {}) {
  const vectors = [];
  for (const batch of batchesOf(texts)) {
    const body = await requestBatch(apiKey, batch, onRetry);
    vectors.push(...vectorsFrom(body, batch.length));
    onProgress?.(vectors.length, texts.length);
  }
  return vectors;
}
