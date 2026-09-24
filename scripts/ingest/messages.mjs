// Every user-facing string of the ERP documentation ingestion script, in Polish, in one place.
// The script is run by service staff, not developers: messages say what happened and what to
// do next, and never show a stack trace (DEBUG=1 adds it).

export const USAGE = `Wgrywanie dokumentacji ERP (PDF) do bazy wiedzy HelpDesku.

Użycie:
  npm run ingest -- [opcje] <plik.pdf | folder> [...]

Folder oznacza wszystkie pliki *.pdf leżące bezpośrednio w nim (bez podfolderów).
Ścieżki ze spacjami podaj w cudzysłowie, np. "C:\\Dokumentacja\\Księgowość.pdf".

Opcje:
  --dry-run            tylko pokaż, na jakie fragmenty zostanie pocięty dokument
                       (bez połączenia z bazą i bez kluczy)
  --lista              pokaż dokumenty wgrane do bazy wiedzy
  --usun <nazwa-pliku> usuń dokument (np. Magazyn.pdf) i jego fragmenty z bazy wiedzy
  --wymus              wgraj ponownie, nawet jeśli plik się nie zmienił
  --pomoc              pokaż tę pomoc

Przykłady:
  npm run ingest -- --dry-run "C:\\Dokumentacja\\Magazyn.pdf"
  npm run ingest -- "C:\\Dokumentacja"
`;

export const MSG = {
  badArguments: (detail) => `Nieprawidłowe wywołanie: ${detail}.\nUżyj --pomoc, aby zobaczyć dostępne opcje.`,
  unknownOption: (option) => `nieznana opcja ${option}`,
  missingOptionValue: (option) => `opcja ${option} wymaga wartości, np. --usun Magazyn.pdf`,
  unexpectedOptionValue: (option) => `opcja ${option} nie przyjmuje wartości`,
  noInputs: "Nie podano żadnego pliku PDF ani folderu. Użyj --pomoc, aby zobaczyć przykłady.",
  notAvailableYet:
    "Wgrywanie do bazy wiedzy (oraz --lista, --usun i --wymus) nie jest jeszcze dostępne w tej wersji skryptu.\n" +
    "Użyj --dry-run, aby zobaczyć, na jakie fragmenty zostanie pocięty dokument.",

  // Input expansion
  inputMissing: (input) => `Nie znaleziono: ${input} — pominięto.`,
  inputNotPdf: (input) => `To nie jest plik PDF: ${input} — pominięto.`,
  folderWithoutPdf: (folder) => `W folderze nie ma plików PDF: ${folder} — pominięto.`,
  inputUnreadable: (input) => `Nie można odczytać: ${input} — pominięto.`,
  duplicateName: (filePath, otherPath) =>
    `Pominięto ${filePath}: plik o tej samej nazwie (${otherPath}) jest już na liście. ` +
    "Dokument w bazie wiedzy jest rozpoznawany po nazwie pliku, więc nazwy muszą być różne.",

  // Per-file progress (dry run)
  dryRunHeader: (count) => `Tryb podglądu (--dry-run): ${count} plik(ów), bez połączenia z bazą.`,
  fileHeader: (index, total, fileName) => `\n[${index}/${total}] ${fileName}`,
  fileSize: (megabytes) => `  Rozmiar:    ${megabytes} MB`,
  fileHash: (hash) => `  SHA-256:    ${hash}`,
  pageCount: (pageCount, pagesWithText) => `  Strony:     ${pageCount} (z tekstem: ${pagesWithText})`,
  fragmentCount: (count) => `  Fragmenty:  ${count}`,
  fragmentPreviewHeader: (shown, total) => `  Pierwsze fragmenty (${shown} z ${total}):`,
  fragmentPreview: (seq, label, length, preview) => `    #${seq}  ${label}  (${length} znaków)\n        ${preview}`,
  fileFailed: (message) => `  BŁĄD: ${message}`,

  // Summary
  summary: (processed, failed) => `\nPodsumowanie: przetworzono ${processed}, błędy ${failed}.`,
};

/** An expected failure with a known Polish explanation; `code` selects the message. */
export class IngestError extends Error {
  constructor(code, detail) {
    super(detail ?? code);
    this.name = "IngestError";
    this.code = code;
    this.detail = detail;
  }
}

const ERROR_MESSAGES = {
  NO_TEXT: () => "PDF nie zawiera tekstu — możliwe, że to skan. Taki dokument trzeba najpierw przepuścić przez OCR.",
  READ_FAILED: (detail) => (detail ? `Nie można odczytać pliku (${detail}).` : "Nie można odczytać pliku."),
};

/**
 * Turns any error thrown while processing a file into one readable Polish line.
 * Known `IngestError` codes map through `ERROR_MESSAGES`; PDF.js parser errors are
 * recognised by name; anything else falls back to the raw message.
 */
export function toUserMessage(error) {
  if (error instanceof IngestError && error.code in ERROR_MESSAGES) return ERROR_MESSAGES[error.code](error.detail);
  const name = error?.name ?? "";
  if (name === "PasswordException") return "PDF jest chroniony hasłem — zapisz go bez hasła i spróbuj ponownie.";
  if (name === "InvalidPDFException" || name === "FormatError")
    return "Plik nie jest poprawnym PDF-em albo jest uszkodzony.";
  const raw = error instanceof Error ? error.message : String(error);
  return `Nieoczekiwany błąd: ${raw}`;
}

/** Stack trace for DEBUG=1 runs; empty otherwise, so staff never see one by default. */
export function debugDetails(error) {
  return process.env.DEBUG === "1" && error instanceof Error && error.stack ? error.stack : "";
}
