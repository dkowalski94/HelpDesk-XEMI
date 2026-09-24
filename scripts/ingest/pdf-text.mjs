// Offline PDF steps: read the file once, hash it, extract its text page by page.
// No network. `unpdf` is a devDependency and is imported only from scripts/, so it never
// reaches the Worker bundle.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";
import { IngestError } from "./messages.mjs";

/** Below this many characters of text in the whole document it is treated as a scan, not as a document with 0 fragments. */
export const MIN_DOCUMENT_CHARS = 200;

/** Lowercase hex SHA-256 of the bytes — the document's content identity (`erp_documents.content_hash`). */
export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Reads a PDF into memory once. The hash is computed here, before parsing, so an unchanged
 * document can be skipped without ever being parsed.
 */
export async function readPdfFile(filePath) {
  let buffer;
  try {
    buffer = await readFile(filePath);
  } catch (error) {
    throw new IngestError("READ_FAILED", error instanceof Error && "code" in error ? String(error.code) : undefined);
  }
  // PDF.js rejects a Node Buffer; view the same memory as a plain Uint8Array (no copy).
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return { bytes, size: bytes.byteLength, contentHash: sha256Hex(bytes) };
}

/** Collapses runs of spaces/tabs, trims every line and keeps at most one blank line between paragraphs. */
export function normalizeWhitespace(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extracts the text layer of every page. Images are never decoded, so a large, screenshot-heavy
 * PDF costs roughly its file size in memory. PDF.js may take ownership of `bytes` (detach its
 * buffer) — hash before calling this, never after.
 *
 * @returns {Promise<{ pageCount: number, pages: string[] }>} `pages[i]` is page i+1, possibly "".
 * @throws {IngestError} code `NO_TEXT` when the whole document has under ~200 characters of text.
 */
export async function extractPages(bytes) {
  // verbosity 0: errors only — PDF.js otherwise prints font warnings between the progress lines.
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = text.map(normalizeWhitespace);
    const totalChars = pages.reduce((sum, page) => sum + page.length, 0);
    if (totalChars < MIN_DOCUMENT_CHARS) throw new IngestError("NO_TEXT");
    return { pageCount: totalPages, pages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
