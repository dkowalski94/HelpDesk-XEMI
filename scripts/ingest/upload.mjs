// The online half of the ingestion script: configuration, signing in as the staff member, and
// every database call. Writes go only through the three functions of migration
// 20260924120000_erp_document_ingestion.sql; the script never holds a key stronger than the
// app's publishable/anon key, so RLS and the functions' staff check stay in force.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createInterface } from "node:readline";
import { URL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { IngestError, MSG, databaseError } from "./messages.mjs";

export const ENV_FILE = ".env.ingest";
/** Resolved against the repository root, so the script finds it from any working directory. */
const ENV_PATH = path.resolve(import.meta.dirname, "..", "..", ENV_FILE);

/** Fragments per stage_erp_document_chunks() call (the function accepts at most 200). */
export const STAGE_BATCH_SIZE = 50;

/**
 * Loads `.env.ingest` into `process.env` (a missing file is fine — the variables may come from
 * the environment) and checks that every value the chosen operation needs is present, before
 * any file is read or any password is asked for.
 *
 * Loaded here rather than with `node --env-file-if-exists`, which prints an English notice when
 * the file is absent; `--dry-run` never gets this far and needs no configuration at all.
 *
 * @param {{ needOpenAi: boolean }} options `OPENAI_API_KEY` is required only to load documents.
 */
export function loadConfig({ needOpenAi }) {
  try {
    process.loadEnvFile(ENV_PATH);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const read = (name) => process.env[name]?.trim() ?? "";
  const required = ["SUPABASE_URL", "SUPABASE_KEY", ...(needOpenAi ? ["OPENAI_API_KEY"] : [])];
  const missing = required.filter((name) => read(name) === "");
  if (missing.length > 0) throw new IngestError("CONFIG_MISSING", { names: missing, envFile: ENV_FILE });

  const supabaseUrl = read("SUPABASE_URL");
  let parsed;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    parsed = undefined;
  }
  if (parsed?.protocol !== "https:" && parsed?.protocol !== "http:")
    throw new IngestError("CONFIG_BAD_URL", { name: "SUPABASE_URL", envFile: ENV_FILE });

  return {
    supabaseUrl,
    supabaseKey: read("SUPABASE_KEY"),
    openAiKey: needOpenAi ? read("OPENAI_API_KEY") : undefined,
    email: read("HELPDESK_EMAIL") || undefined,
  };
}

/**
 * Asks one question on the terminal. With `hidden`, nothing typed is echoed — the password is
 * never shown, logged or stored. Requires an interactive terminal: with stdin redirected (or
 * mintty's pipe in plain Git Bash) typed characters could not be hidden, so it refuses instead.
 */
function ask(question, { hidden = false } = {}) {
  if (!process.stdin.isTTY) return Promise.reject(new IngestError("NO_TERMINAL"));

  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    let answered = false;
    if (hidden) {
      // readline echoes every keystroke through _writeToOutput; swallow them once the prompt is out.
      const write = rl._writeToOutput.bind(rl);
      rl._writeToOutput = (text) => {
        if (!muted) write(text);
      };
    }
    rl.on("SIGINT", () => {
      rl.close();
    });
    rl.on("close", () => {
      if (hidden) process.stdout.write("\n");
      if (!answered) reject(new IngestError("CANCELLED"));
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
    muted = hidden; // the prompt itself was written synchronously by question()
  });
}

/**
 * Signs in with the staff member's own HelpDesk account and checks their role before any file is
 * touched. The email may come from HELPDESK_EMAIL; the password is always typed.
 *
 * @returns {Promise<import("@supabase/supabase-js").SupabaseClient>} a client acting as that user
 */
export async function signIn(config) {
  const email = config.email ?? (await ask(MSG.emailPrompt)).trim();
  if (!email) throw new IngestError("EMPTY_INPUT");
  const password = await ask(MSG.passwordPrompt, { hidden: true });
  if (!password) throw new IngestError("EMPTY_INPUT");

  const client = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false, detectSessionInUrl: false },
  });

  console.log(MSG.signingIn(email));
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw databaseError(error);

  const profile = await client.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (profile.error) throw databaseError(profile.error, profile.status);
  if (profile.data?.role !== "service_staff") {
    await signOut(client);
    throw new IngestError("NOT_STAFF");
  }

  console.log(MSG.signedIn);
  return client;
}

/**
 * Ends this session only (scope "local": the staff member stays signed in to the HelpDesk app in
 * their browser) and stops the auth refresh timer. Never throws.
 */
export async function signOut(client) {
  try {
    await client.auth.signOut({ scope: "local" });
  } catch {
    // The run is over either way; a failed sign-out only leaves a token that expires on its own.
  }
  await client.auth.stopAutoRefresh();
}

/**
 * The registry row of a document, matched case-insensitively by base name like the unique index
 * `lower(file_name)`. The registry holds one row per ERP PDF (~20), so it is read whole and
 * compared here rather than turned into a LIKE pattern that would need escaping.
 *
 * @returns {Promise<{ id: string, file_name: string, content_hash: string } | undefined>}
 */
export async function findDocument(client, fileName) {
  const { data, error, status } = await client.from("erp_documents").select("id, file_name, content_hash");
  if (error) throw databaseError(error, status);
  const key = fileName.toLowerCase();
  return data.find((row) => row.file_name.toLowerCase() === key);
}

/**
 * Stages every fragment under a fresh upload id, in batches, then publishes the upload in one
 * transaction. Until publish succeeds, knowledge_base_entries is untouched; a run killed here
 * leaves only staging rows, which a later publish clears.
 *
 * @param {{ fileName: string, contentHash: string, pageCount: number,
 *           fragments: { seq: number, label: string, text: string, embedding: number[] }[] }} document
 * @param {(batch: number, total: number) => void} [onBatch]
 * @returns {Promise<{ documentId: string, chunkCount: number }>}
 */
export async function uploadDocument(client, { fileName, contentHash, pageCount, fragments }, onBatch) {
  const uploadId = randomUUID();
  const batches = Math.ceil(fragments.length / STAGE_BATCH_SIZE);

  for (let index = 0; index < batches; index++) {
    const chunks = fragments.slice(index * STAGE_BATCH_SIZE, (index + 1) * STAGE_BATCH_SIZE).map((fragment) => ({
      seq: fragment.seq,
      error_text: fragment.label,
      steps: fragment.text,
      // pgvector's text format is a JSON array, so the function casts this directly.
      embedding: fragment.embedding,
    }));
    const { error, status } = await client.rpc("stage_erp_document_chunks", {
      p_upload_id: uploadId,
      p_file_name: fileName,
      p_content_hash: contentHash,
      p_chunks: chunks,
    });
    if (error) throw databaseError(error, status);
    onBatch?.(index + 1, batches);
  }

  const { data, error, status } = await client.rpc("publish_erp_document", {
    p_upload_id: uploadId,
    p_page_count: pageCount,
  });
  if (error) throw databaseError(error, status);
  const row = Array.isArray(data) ? data[0] : data;
  return { documentId: row?.document_id, chunkCount: row?.chunk_count ?? fragments.length };
}

/**
 * Every loaded document, newest first, with the email of whoever loaded it when their profile is
 * readable (staff read every profile; a deleted account leaves `ingested_by` null).
 */
export async function listDocuments(client) {
  const { data, error, status } = await client
    .from("erp_documents")
    .select("file_name, ingested_at, ingested_by, page_count, chunk_count")
    .order("ingested_at", { ascending: false });
  if (error) throw databaseError(error, status);

  const ids = [...new Set(data.map((row) => row.ingested_by).filter(Boolean))];
  const emails = new Map();
  if (ids.length > 0) {
    const profiles = await client.from("profiles").select("id, email").in("id", ids);
    // Who loaded a document is a nicety; an unreadable profile shows "—" instead of failing.
    if (!profiles.error) for (const profile of profiles.data) emails.set(profile.id, profile.email);
  }

  return data.map((row) => ({
    fileName: row.file_name,
    ingestedAt: row.ingested_at,
    ingestedBy: emails.get(row.ingested_by),
    pageCount: row.page_count,
    chunkCount: row.chunk_count,
  }));
}

/** Removes a document and, through the cascade, its entries. Returns whether it existed. */
export async function removeDocument(client, fileName) {
  const { data, error, status } = await client.rpc("remove_erp_document", { p_file_name: fileName });
  if (error) throw databaseError(error, status);
  return data === true;
}
