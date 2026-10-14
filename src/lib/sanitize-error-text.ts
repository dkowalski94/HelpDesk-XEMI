/*
 * Strips company-identifying data from an error text before it becomes a shared
 * knowledge base entry, which `match_knowledge_base` shows to every client company.
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Masks e-mails, account numbers, NIPs, phone numbers, document numbers, amounts,
 * any other run of 5+ digits and — when given — the reporting company's name, then
 * collapses whitespace. Runs of 1–4 digits (ERP error codes, years) are kept.
 */
export function sanitizeErrorText(text: string, companyName: string | null): string {
  let result = text;
  for (const { pattern, placeholder, requireDigit } of RULES) {
    result = result.replace(pattern, (match) => (requireDigit && !/\d/.test(match) ? match : placeholder));
  }

  const name = companyName?.trim();
  if (name) {
    result = result.replace(new RegExp(escapeRegExp(name), "giu"), "[firma]");
  }

  return result.replace(/\s+/g, " ").trim();
}
