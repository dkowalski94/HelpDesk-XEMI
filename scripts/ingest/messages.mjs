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
  npm run ingest -- --lista
  npm run ingest -- --usun Magazyn.pdf
`;

export const MSG = {
  badArguments: (detail) => `Nieprawidłowe wywołanie: ${detail}.\nUżyj --pomoc, aby zobaczyć dostępne opcje.`,
  unknownOption: (option) => `nieznana opcja ${option}`,
  missingOptionValue: (option) => `opcja ${option} wymaga wartości, np. --usun Magazyn.pdf`,
  unexpectedOptionValue: (option) => `opcja ${option} nie przyjmuje wartości`,
  noInputs: "Nie podano żadnego pliku PDF ani folderu. Użyj --pomoc, aby zobaczyć przykłady.",
  conflictingOptions:
    "Tych opcji nie można łączyć: --dry-run, --lista i --usun działają osobno, --wymus działa tylko przy " +
    "wgrywaniu plików, a --lista i --usun nie przyjmują plików. Użyj --pomoc, aby zobaczyć przykłady.",
  fatal: (message) => `BŁĄD: ${message}`,

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

  // Sign-in
  emailPrompt: "E-mail konta serwisanta w HelpDesku: ",
  passwordPrompt: "Hasło (nie jest wyświetlane podczas wpisywania): ",
  signingIn: (email) => `Logowanie jako ${email}...`,
  signedIn: "Zalogowano.",

  // Load
  loadHeader: (count) => `Wgrywanie do bazy wiedzy: ${count} plik(ów).`,
  unchangedSkipped: "  Bez zmian, pominięto (ten sam plik jest już w bazie; --wymus wgra go ponownie).",
  embedding: (done, total) => `  Obliczanie wektorów (OpenAI): ${done}/${total}`,
  openAiRetry: (seconds, attempt, maxAttempts) =>
    `  OpenAI chwilowo nie odpowiada lub ogranicza liczbę zapytań — ponowna próba za ${seconds} s (${attempt}/${maxAttempts})...`,
  uploading: (batch, total) => `  wysyłanie ${batch}/${total}`,
  // Details of OPENAI_BAD_RESPONSE
  badJson: "odpowiedź nie jest poprawnym JSON-em",
  vectorCount: (expected, received) => `oczekiwano ${expected} wektorów, otrzymano ${received}`,
  vectorOrder: "nieprawidłowa kolejność wektorów",
  vectorDimensions: (received, expected) => `wektor ma ${received} wymiarów zamiast ${expected}`,
  vectorValues: "wektor zawiera nieprawidłowe liczby",
  published: (count) => `  Dodano nowy dokument: ${count} fragmentów.`,
  replaced: (count) => `  Zastąpiono poprzednią wersję dokumentu: ${count} fragmentów.`,
  loadSummary: ({ added, replaced, skipped, failed }) =>
    `\nPodsumowanie: dodano ${added}, zastąpiono ${replaced}, bez zmian ${skipped}, błędy ${failed}.`,
  aborted: (remaining) =>
    remaining > 0 ? `Przerwano — pozostałe pliki (${remaining}) nie zostały przetworzone.` : "Przerwano.",

  // --lista
  listEmpty: "Baza wiedzy nie zawiera jeszcze żadnych dokumentów ERP.",
  listHeader: (count) => `Dokumenty ERP w bazie wiedzy: ${count}\n`,
  listColumns: ["Plik", "Wgrano", "Wgrał(a)", "Strony", "Fragmenty"],
  unknownPerson: "—",

  // --usun
  removed: (fileName) => `Usunięto dokument ${fileName} i jego fragmenty z bazy wiedzy.`,
  notFound: (fileName) => `Nie znaleziono dokumentu ${fileName} w bazie wiedzy (--lista pokazuje wgrane dokumenty).`,
};

/** An expected failure with a known Polish explanation; `code` selects the message. */
export class IngestError extends Error {
  constructor(code, detail, options) {
    super(detail ?? code, options);
    this.name = "IngestError";
    this.code = code;
    this.detail = detail;
  }

  /** Errors that would repeat identically for every remaining file stop the whole run. */
  get fatal() {
    return FATAL_CODES.has(this.code);
  }
}

const FATAL_CODES = new Set([
  "OPENAI_KEY_INVALID",
  "OPENAI_QUOTA",
  "DB_NETWORK",
  "DB_DENIED",
  "DB_MIGRATION_MISSING",
  "INVALID_CREDENTIALS",
  "NOT_STAFF",
]);

const ENV_FILE_HINT = (envFile) =>
  `Uzupełnij plik ${envFile} (w folderze projektu) — każda wartość w osobnej linii, np. NAZWA=wartość.`;

const ERROR_MESSAGES = {
  NO_TEXT: () => "PDF nie zawiera tekstu — możliwe, że to skan. Taki dokument trzeba najpierw przepuścić przez OCR.",
  READ_FAILED: (detail) => (detail ? `Nie można odczytać pliku (${detail}).` : "Nie można odczytać pliku."),

  // Configuration (.env.ingest); detail = { names, envFile } or { name, envFile }
  CONFIG_MISSING: ({ names, envFile }) =>
    `${names.length === 1 ? `Brak ustawienia ${names[0]}` : `Brak ustawień: ${names.join(", ")}`}. ${ENV_FILE_HINT(envFile)}`,
  CONFIG_BAD_URL: ({ name, envFile }) =>
    `Ustawienie ${name} nie jest poprawnym adresem (powinno wyglądać jak https://xxxx.supabase.co). ${ENV_FILE_HINT(envFile)}`,
  CONFIG_SECRET_KEY: ({ envFile }) =>
    `Ustawienie SUPABASE_KEY zawiera klucz tajny (service_role / sb_secret_…), który daje pełny dostęp do bazy. Wpisz klucz publiczny (anon / sb_publishable_…), a klucz tajny usuń z pliku ${envFile}.`,
  CONFIG_ENCODING: ({ envFile }) =>
    `Plik ${envFile} jest zapisany w kodowaniu UTF-16, którego nie da się odczytać. Otwórz go w Notatniku i zapisz ponownie, wybierając kodowanie „UTF-8”.`,

  // Prompting
  NO_TERMINAL: () =>
    "Nie można bezpiecznie zapytać o hasło, bo skrypt nie działa w zwykłym oknie terminala. " +
    "Uruchom go w PowerShellu, Wierszu polecenia albo Windows Terminal (w samym Git Bash wpisz: winpty npm.cmd run ingest -- ...).",
  CANCELLED: () => "Anulowano.",
  EMPTY_INPUT: () => "Nie podano e-maila albo hasła.",

  // Sign-in and database
  INVALID_CREDENTIALS: () => "Nieprawidłowy e-mail lub hasło. Użyj tych samych danych, co przy logowaniu do HelpDesku.",
  EMAIL_NOT_CONFIRMED: () =>
    "Adres e-mail tego konta nie został jeszcze potwierdzony. Potwierdź go i spróbuj ponownie.",
  NOT_STAFF: () => "To konto nie jest kontem serwisanta. Dokumentację ERP może wgrywać tylko serwisant.",
  DB_DENIED: () => "Baza odmówiła dostępu — ta operacja jest dostępna tylko dla konta serwisanta.",
  DB_NETWORK: (detail) =>
    `Nie można połączyć się z bazą HelpDesku${detail ? ` (${detail})` : ""}. ` +
    "Sprawdź połączenie z internetem i ustawienie SUPABASE_URL; jeśli wszystko się zgadza, baza może być chwilowo niedostępna.",
  DB_MIGRATION_MISSING: () => "Baza nie ma jeszcze migracji — skontaktuj się z administratorem.",
  DB_UPLOAD_INTERRUPTED: () =>
    "Wysyłanie dokumentu zostało przerwane lub zakłócone (np. przez drugie jednoczesne wgrywanie). Baza HelpDesku jest bez zmian — uruchom wgrywanie ponownie.",
  DB_TIMEOUT: () =>
    "Baza przerwała zapis dokumentu, bo trwał za długo. Baza HelpDesku jest bez zmian — spróbuj ponownie, a jeśli błąd się powtarza, skontaktuj się z administratorem.",
  DB_FAILED: (detail) => `Baza odpowiedziała błędem: ${detail ?? "brak szczegółów"}`,

  // OpenAI
  OPENAI_KEY_INVALID: () => "Klucz OpenAI jest nieprawidłowy. Sprawdź ustawienie OPENAI_API_KEY w pliku .env.ingest.",
  OPENAI_QUOTA: () =>
    "Konto OpenAI nie ma już środków (limit wykorzystany). Doładuj konto lub zmień limit na platform.openai.com i spróbuj ponownie.",
  OPENAI_NETWORK: (detail) =>
    `Nie można połączyć się z OpenAI${detail ? ` (${detail})` : ""} mimo kilku prób. Sprawdź połączenie z internetem i spróbuj ponownie.`,
  OPENAI_FAILED: (detail) => `OpenAI odpowiedziało błędem: ${detail ?? "brak szczegółów"}`,
  OPENAI_BAD_RESPONSE: (detail) =>
    `OpenAI zwróciło nieoczekiwaną odpowiedź (${detail ?? "brak szczegółów"}). Spróbuj ponownie.`,
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

// PostgREST: PGRST202 = function not found in the schema cache, PGRST205 = table not found;
// Postgres: 42883 = undefined function, 42P01 = undefined table.
const MISSING_SCHEMA_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);

// publish_erp_document() raises these (P0001) when an upload is incomplete or was disturbed while
// publishing; a fresh run fixes all of them. Other P0001 texts fall through to DB_FAILED.
const UPLOAD_INTERRUPTED_MESSAGES = [/^incomplete upload /, /changed while publishing/, /mixes fragments/];

/**
 * Maps an error returned by supabase-js (auth or PostgREST) to an `IngestError`.
 * `status` is the HTTP status of the PostgREST response; 0 means the request never reached a
 * server (DNS, refused connection, no internet).
 */
export function databaseError(error, status) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message : String(error);
  const options = { cause: error };

  if (error?.name === "AuthRetryableFetchError" || status === 0)
    return new IngestError("DB_NETWORK", error?.status ? `HTTP ${error.status}` : undefined, options);
  if (code === "invalid_credentials") return new IngestError("INVALID_CREDENTIALS", undefined, options);
  if (code === "email_not_confirmed") return new IngestError("EMAIL_NOT_CONFIRMED", undefined, options);
  if (code === "42501") return new IngestError("DB_DENIED", undefined, options);
  // 57014 = query_canceled: the role's statement_timeout (8 s for authenticated) cut the call off.
  if (code === "57014") return new IngestError("DB_TIMEOUT", undefined, options);
  if (code === "P0001" && UPLOAD_INTERRUPTED_MESSAGES.some((pattern) => pattern.test(message)))
    return new IngestError("DB_UPLOAD_INTERRUPTED", undefined, options);
  if (MISSING_SCHEMA_CODES.has(code)) return new IngestError("DB_MIGRATION_MISSING", undefined, options);
  return new IngestError("DB_FAILED", message, options);
}

/** Stack trace for DEBUG=1 runs; empty otherwise, so staff never see one by default. */
export function debugDetails(error) {
  if (process.env.DEBUG !== "1" || !(error instanceof Error) || !error.stack) return "";
  const cause = error.cause;
  if (cause === undefined) return error.stack;
  const causeText = cause instanceof Error && cause.stack ? cause.stack : JSON.stringify(cause, null, 2);
  return `${error.stack}\nCaused by: ${causeText}`;
}
