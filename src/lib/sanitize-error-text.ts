/*
 * Strips company-identifying data from an error text, and from the cause and steps
 * staff write for it, before they become a shared knowledge base entry, which
 * `match_knowledge_base` shows to every client company.
 *
 * Dependency-free on purpose: the staff page renders the same preview the server
 * stores, so this module must never import `astro:env` or `@/lib/openai`.
 *
 * A deterministic, incomplete filter is the accepted design: only patterns with a
 * recognisable shape are masked, and values the rules cannot see — a counterparty's
 * name, a product code — pass through. Staff cannot edit the result by decision.
 */

/** Letters (Polish included) and digits — the characters a token is made of. */
const WORD = String.raw`[\p{L}\d]`;

/**
 * Applied in this order. Specific shapes run before the generic run of 5+ digits,
 * which would otherwise eat them first and leave an uninformative `[liczba]`.
 */
const RULES: { pattern: RegExp; placeholder: string; requireDigit?: boolean }[] = [
  { pattern: /[\p{L}\d._%+-]+@[\p{L}\d.-]+\.\p{L}{2,}/gu, placeholder: "[e-mail]" },
  // Bank account / IBAN: optional PL, 26 digits, spaces allowed between them.
  { pattern: /(?<![\p{L}\d])(?:PL[ \u00a0]?)?\d(?:[ \u00a0]?\d){25}(?!\d)/gu, placeholder: "[konto]" },
  // NIP in the 3-3-2-2 or 3-2-2-3 layout, dashes optional.
  {
    pattern: /(?<!\d)(?:\d{3}-?\d{3}-?\d{2}-?\d{2}|\d{3}-?\d{2}-?\d{2}-?\d{3})(?!\d)/gu,
    placeholder: "[NIP]",
  },
  // Phone: optional +48, nine digits in 3-3-3 or 2-3-2-2 groups. Not followed by a
  // decimal comma, so a grouped amount is left to the amount rule.
  {
    pattern: /(?<![\p{L}\d+])(?:\+48[ -]?)?(?:\d{3}[ -]?\d{3}[ -]?\d{3}|\d{2}[ -]\d{3}[ -]\d{2}[ -]\d{2})(?!\d|,\d)/gu,
    placeholder: "[telefon]",
  },
  // Document number: a letters-and-digits token with at least one `/` and one digit,
  // e.g. FV/123/2026 or ZK/12/09/26. The digit is checked in the replacer.
  {
    pattern: new RegExp(String.raw`(?<![\p{L}\d/])${WORD}+(?:/${WORD}+)+(?![\p{L}\d/])`, "gu"),
    placeholder: "[nr dokumentu]",
    requireDigit: true,
  },
  // Amount with a decimal comma, thousands optionally grouped by (non-breaking) spaces,
  // optional currency. Grouping is strict so a preceding error code is not swallowed.
  {
    pattern: /(?<![\d,.])(?:\d{1,3}(?:[ \u00a0]\d{3})+|\d+),\d{2}(?!\d)(?:[ \u00a0]?(?:zł|PLN)(?!\p{L}))?/gu,
    placeholder: "[kwota]",
  },
  { pattern: /(?<!\d)\d{5,}(?!\d)/gu, placeholder: "[liczba]" },
];

/**
 * XEMI prints a person as "NAZWISKO IMIĘ" in capitals: two or more all-caps words
 * (hyphenated surnames included). A single capitalised word such as `ERR` is kept;
 * an all-caps phrase that is not a person is masked too, which is the accepted cost.
 */
const PERSON_NAME = /(?<![\p{L}\d])\p{Lu}{2,}(?:-\p{Lu}{2,})*(?:[ \u00a0]+\p{Lu}{2,}(?:-\p{Lu}{2,})*)+(?![\p{L}\d])/gu;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskCompanyData(text: string, companyName: string | null): string {
  let result = text;

  // First, while the name is intact: a later rule would turn digits or a `/` inside it into
  // a placeholder, and an upper-case name into `[osoba]`. Any whitespace run may separate its words.
  const words = companyName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length > 0) {
    result = result.replace(new RegExp(words.map(escapeRegExp).join(String.raw`\s+`), "giu"), "[firma]");
  }

  for (const { pattern, placeholder, requireDigit } of RULES) {
    result = result.replace(pattern, (match) => (requireDigit && !/\d/.test(match) ? match : placeholder));
  }

  return result.replace(PERSON_NAME, "[osoba]");
}

/**
 * Masks the reporting company's name (when given), e-mails, account numbers, NIPs, phone
 * numbers, document numbers, amounts, any other run of 5+ digits and all-caps person names,
 * then collapses whitespace. Runs of 1–4 digits (ERP error codes, years) are kept.
 */
export function sanitizeErrorText(text: string, companyName: string | null): string {
  return maskCompanyData(text, companyName).replace(/\s+/g, " ").trim();
}

/**
 * Same masking for the cause and steps staff write, which the knowledge base also shows to
 * other companies. Line breaks are kept, because numbered steps read one per line.
 */
export function sanitizeResolutionText(text: string, companyName: string | null): string {
  return maskCompanyData(text, companyName)
    .split(/\r?\n/)
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
