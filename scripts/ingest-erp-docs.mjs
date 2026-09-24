// Loads the ERP (XEMI) documentation PDFs into the shared knowledge base (roadmap F-02).
// Run by a service-staff member on their own machine: `npm run ingest -- <plik.pdf | folder> ...`
// Offline (`--dry-run`): read, hash, extract, chunk, print — no configuration, no network.
// Online (load, `--lista`, `--usun`): validate .env.ingest, sign in as the staff member and check
// the role before touching any file; then per file hash → skip if unchanged → extract → chunk →
// embed all fragments → stage in batches → publish. Nothing reaches the knowledge base before
// every fragment has its embedding and is staged.
// All user-facing text lives in scripts/ingest/messages.mjs.

import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { chunkPages, fragmentLabel } from "./ingest/chunking.mjs";
import { embedTexts } from "./ingest/embeddings.mjs";
import { IngestError, MSG, USAGE, debugDetails, toUserMessage } from "./ingest/messages.mjs";
import { extractPages, readPdfFile } from "./ingest/pdf-text.mjs";
import {
  findDocument,
  listDocuments,
  loadConfig,
  removeDocument,
  signIn,
  signOut,
  uploadDocument,
} from "./ingest/upload.mjs";

const PREVIEW_FRAGMENTS = 3;
const PREVIEW_CHARS = 200;

const isPdfName = (name) => path.extname(name).toLowerCase() === ".pdf";

/**
 * A document's identity: the base name in Unicode NFC. Names copied from macOS or some ZIP tools
 * spell "ę" as "e" + combining ogonek (NFD); without this, the same file would be two documents.
 */
const documentName = (filePath) => path.basename(filePath).normalize("NFC");

function printError(error) {
  const details = debugDetails(error);
  if (details) console.error(details);
}

/**
 * Expands the positional arguments into a list of PDF paths: a file is taken as is, a folder
 * means its *.pdf files (non-recursive, any letter case). Missing, unreadable and non-PDF
 * inputs are reported and counted as problems. Two files with the same base name (compared
 * case-insensitively, as Windows and the database do) cannot both be loaded — the document's
 * identity is its base name — so the second one is reported and skipped.
 */
async function expandInputs(inputs) {
  const files = [];
  let problems = 0;

  for (const input of inputs) {
    let info;
    try {
      info = await stat(input);
    } catch (error) {
      console.log(error?.code === "ENOENT" ? MSG.inputMissing(input) : MSG.inputUnreadable(input));
      printError(error);
      problems++;
      continue;
    }

    if (info.isDirectory()) {
      let entries;
      try {
        entries = await readdir(input, { withFileTypes: true });
      } catch (error) {
        console.log(MSG.inputUnreadable(input));
        printError(error);
        problems++;
        continue;
      }
      const pdfs = entries
        .filter((entry) => entry.isFile() && isPdfName(entry.name))
        .map((entry) => path.join(input, entry.name))
        .sort((a, b) => a.localeCompare(b, "pl"));
      if (pdfs.length === 0) {
        console.log(MSG.folderWithoutPdf(input));
        problems++;
      }
      files.push(...pdfs);
    } else if (info.isFile() && isPdfName(input)) {
      files.push(input);
    } else {
      console.log(MSG.inputNotPdf(input));
      problems++;
    }
  }

  const byName = new Map();
  const unique = [];
  for (const filePath of files) {
    // realpath gives one spelling per file on a case-insensitive disk (magazyn.pdf vs Magazyn.pdf,
    // short 8.3 names), so the same file reached two ways is not mistaken for a name clash.
    let resolved;
    try {
      resolved = await realpath(filePath);
    } catch (error) {
      console.log(MSG.inputUnreadable(filePath));
      printError(error);
      problems++;
      continue;
    }
    const key = documentName(resolved).toLowerCase();
    const seen = byName.get(key);
    if (seen === resolved) continue; // the same file given twice (e.g. itself and its folder)
    if (seen !== undefined) {
      console.log(MSG.duplicateName(filePath, seen));
      problems++;
      continue;
    }
    byName.set(key, resolved);
    unique.push(resolved);
  }

  return { files: unique, problems };
}

/** `parseArgs` throws English messages; name the offending option in Polish instead. */
function describeArgumentError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const option = /'(-[^'\s]+)/.exec(message)?.[1] ?? "";
  if (error?.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") return MSG.unknownOption(option);
  if (error?.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE")
    // "argument is ambiguous": the value looks like another option (--usun --lista), i.e. it is missing.
    return /argument missing|ambiguous/.test(message)
      ? MSG.missingOptionValue(option)
      : MSG.unexpectedOptionValue(option);
  return message;
}

function preview(text) {
  const flat = text.replace(/\s+/g, " ");
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

/** Read → hash → extract → chunk → print. Throws on a per-file failure; the caller reports it. */
async function dryRunFile(filePath) {
  const fileName = documentName(filePath);
  const { bytes, size, contentHash } = await readPdfFile(filePath);
  console.log(MSG.fileSize((size / (1024 * 1024)).toFixed(1)));
  console.log(MSG.fileHash(contentHash));

  const { pageCount, pages } = await extractPages(bytes);
  console.log(MSG.pageCount(pageCount, pages.filter(Boolean).length));

  const fragments = chunkPages(pages);
  console.log(MSG.fragmentCount(fragments.length));

  const shown = fragments.slice(0, PREVIEW_FRAGMENTS);
  console.log(MSG.fragmentPreviewHeader(shown.length, fragments.length));
  for (const fragment of shown) {
    console.log(
      MSG.fragmentPreview(
        fragment.seq,
        fragmentLabel(fileName, fragment),
        fragment.text.length,
        preview(fragment.text),
      ),
    );
  }
}

/**
 * Hash → skip if unchanged → extract → chunk → embed → stage → publish.
 * Returns "skipped" | "added" | "replaced". Throws on a per-file failure; the caller reports it.
 */
async function loadFile(client, config, filePath, force) {
  const fileName = documentName(filePath);
  const { bytes, contentHash } = await readPdfFile(filePath);

  // Before parsing: a routine re-run over the whole folder costs one hash per unchanged file.
  const existing = await findDocument(client, fileName);
  if (existing?.content_hash === contentHash && !force) {
    console.log(MSG.unchangedSkipped);
    return "skipped";
  }

  const { pageCount, pages } = await extractPages(bytes);
  console.log(MSG.pageCount(pageCount, pages.filter(Boolean).length));
  const fragments = chunkPages(pages);
  console.log(MSG.fragmentCount(fragments.length));

  const embeddings = await embedTexts(
    config.openAiKey,
    fragments.map((fragment) => fragment.text),
    {
      onProgress: (done, total) => {
        console.log(MSG.embedding(done, total));
      },
      onRetry: (seconds, attempt, maxAttempts) => {
        console.log(MSG.openAiRetry(seconds, attempt, maxAttempts));
      },
    },
  );

  const { chunkCount } = await uploadDocument(
    client,
    {
      fileName,
      contentHash,
      pageCount,
      fragments: fragments.map((fragment, index) => ({
        seq: fragment.seq,
        label: fragmentLabel(fileName, fragment),
        text: fragment.text,
        embedding: embeddings[index],
      })),
    },
    (batch, total) => {
      console.log(MSG.uploading(batch, total));
    },
  );

  console.log(existing ? MSG.replaced(chunkCount) : MSG.published(chunkCount));
  return existing ? "replaced" : "added";
}

async function loadFiles(client, config, inputs, force) {
  const { files, problems } = await expandInputs(inputs);
  const counts = { added: 0, replaced: 0, skipped: 0, failed: problems };

  if (files.length > 0) console.log(MSG.loadHeader(files.length));
  for (const [index, filePath] of files.entries()) {
    console.log(MSG.fileHeader(index + 1, files.length, path.basename(filePath)));
    try {
      counts[await loadFile(client, config, filePath, force)]++;
    } catch (error) {
      console.log(MSG.fileFailed(toUserMessage(error)));
      printError(error);
      counts.failed++;
      // A bad OpenAI key or an unreachable database would fail every remaining file the same way.
      if (error instanceof IngestError && error.fatal) {
        console.log(MSG.aborted(files.length - index - 1));
        break;
      }
    }
  }

  console.log(MSG.loadSummary(counts));
  return counts.failed > 0 ? 1 : 0;
}

function formatDate(value) {
  return new Date(value).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
}

async function printDocumentList(client) {
  const documents = await listDocuments(client);
  if (documents.length === 0) {
    console.log(MSG.listEmpty);
    return;
  }

  const rows = documents.map((document) => [
    document.fileName,
    formatDate(document.ingestedAt),
    document.ingestedBy ?? MSG.unknownPerson,
    String(document.pageCount),
    String(document.chunkCount),
  ]);
  const widths = MSG.listColumns.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length)),
  );
  const numeric = new Set([3, 4]);
  const line = (cells) =>
    cells
      .map((cell, column) => (numeric.has(column) ? cell.padStart(widths[column]) : cell.padEnd(widths[column])))
      .join("  ")
      .trimEnd();

  console.log(MSG.listHeader(documents.length));
  console.log(line(MSG.listColumns));
  console.log(line(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(line(row));
}

async function removeByName(client, name) {
  // Identity is the base name; accept a full path too, as staff may paste one.
  const fileName = documentName(name.trim());
  const removed = await removeDocument(client, fileName);
  console.log(removed ? MSG.removed(fileName) : MSG.notFound(fileName));
  return 0;
}

/** --lista, --usun and a real load: configuration → sign-in and role check → the operation. */
async function runOnline(values, positionals) {
  const isLoad = !values.lista && values.usun === undefined;
  const config = loadConfig({ needOpenAi: isLoad });
  const client = await signIn(config);
  try {
    if (values.lista) {
      await printDocumentList(client);
      return 0;
    }
    if (values.usun !== undefined) return await removeByName(client, values.usun);
    return await loadFiles(client, config, positionals, values.wymus === true);
  } finally {
    await signOut(client);
  }
}

async function main() {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        "dry-run": { type: "boolean" },
        lista: { type: "boolean" },
        usun: { type: "string" },
        wymus: { type: "boolean" },
        pomoc: { type: "boolean" },
      },
    }));
  } catch (error) {
    console.error(MSG.badArguments(describeArgumentError(error)));
    printError(error);
    return 1;
  }

  const anyFlag = Object.values(values).some((value) => value !== undefined);
  if (values.pomoc || (!anyFlag && positionals.length === 0)) {
    console.log(USAGE);
    return 0;
  }

  const dryRun = values["dry-run"] === true;
  const listOrRemove = values.lista === true || values.usun !== undefined;
  const conflicting =
    [dryRun, values.lista === true, values.usun !== undefined].filter(Boolean).length > 1 ||
    (values.wymus === true && (dryRun || listOrRemove)) ||
    (listOrRemove && positionals.length > 0);
  if (conflicting) {
    console.error(MSG.conflictingOptions);
    return 1;
  }
  if (values.usun?.trim() === "") {
    console.error(MSG.badArguments(MSG.missingOptionValue("--usun")));
    return 1;
  }

  if (!listOrRemove && positionals.length === 0) {
    console.error(MSG.noInputs);
    return 1;
  }

  if (!dryRun) {
    try {
      return await runOnline(values, positionals);
    } catch (error) {
      console.error(MSG.fatal(toUserMessage(error)));
      printError(error);
      return 1;
    }
  }

  const { files, problems } = await expandInputs(positionals);
  let failed = problems;
  let processed = 0;

  if (files.length > 0) console.log(MSG.dryRunHeader(files.length));
  for (const [index, filePath] of files.entries()) {
    console.log(MSG.fileHeader(index + 1, files.length, path.basename(filePath)));
    try {
      await dryRunFile(filePath);
      processed++;
    } catch (error) {
      console.log(MSG.fileFailed(toUserMessage(error)));
      printError(error);
      failed++;
    }
  }

  console.log(MSG.summary(processed, failed));
  return failed > 0 ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(MSG.fileFailed(toUserMessage(error)));
  printError(error);
  process.exitCode = 1;
}
