// Loads the ERP (XEMI) documentation PDFs into the shared knowledge base (roadmap F-02).
// Run by a service-staff member on their own machine: `npm run ingest -- <plik.pdf | folder> ...`
// This version implements the offline half only (`--dry-run`): read, hash, extract, chunk, print.
// All user-facing text lives in scripts/ingest/messages.mjs.

import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { chunkPages, fragmentLabel } from "./ingest/chunking.mjs";
import { MSG, USAGE, debugDetails, toUserMessage } from "./ingest/messages.mjs";
import { extractPages, readPdfFile } from "./ingest/pdf-text.mjs";

const PREVIEW_FRAGMENTS = 3;
const PREVIEW_CHARS = 200;

const isPdfName = (name) => path.extname(name).toLowerCase() === ".pdf";

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
    const resolved = await realpath(filePath);
    const key = path.basename(resolved).toLowerCase();
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
    return message.includes("argument missing") ? MSG.missingOptionValue(option) : MSG.unexpectedOptionValue(option);
  return message;
}

function preview(text) {
  const flat = text.replace(/\s+/g, " ");
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

/** Read → hash → extract → chunk → print. Throws on a per-file failure; the caller reports it. */
async function dryRunFile(filePath) {
  const fileName = path.basename(filePath);
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

  // --lista, --usun, --wymus and a real load need the database (next version of the script).
  if (!values["dry-run"] || values.lista || values.usun !== undefined || values.wymus) {
    console.error(MSG.notAvailableYet);
    return 1;
  }

  if (positionals.length === 0) {
    console.error(MSG.noInputs);
    return 1;
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
