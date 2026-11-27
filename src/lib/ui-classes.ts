/**
 * Shared class strings of the views on the UI contract (CLAUDE.md → UI contract): page cards,
 * typography and the controls that are not shadcn primitives. Token roles only. Every name ends in
 * `_CLASS`/`_CARD`/`_ROWS` so the `uiContractConfig` lint rule checks the values.
 *
 * Primitives (`Button`, `Input`, `Textarea`, `Badge`, `buttonVariants()` links) already draw a
 * full-strength focus ring — do not add one on top of them.
 */

/** The page card of a working page (`PageShell` `panel`). */
export const PAGE_CARD_CLASS = "gap-0 p-6 sm:p-8";

/** The start page card (`PageShell` `hero`): grows to fill the frame's height. */
export const HERO_CARD_CLASS = "flex-1 gap-0 p-6 sm:p-10";

/** The centred, narrow card of the auth pages (`PageShell` `narrow`). */
export const NARROW_CARD_CLASS = "mx-auto w-full max-w-md gap-0 p-6 sm:p-8";

/** The page `h1` (and its status-message stand-ins). */
export const HEADING_CLASS = "mb-2 text-2xl font-bold text-foreground";

/** The start page `h1`. */
export const HERO_HEADING_CLASS = "mb-2 text-3xl font-bold text-foreground sm:text-4xl";

/** A section `h2` inside a page card; add a colour role after it for an outcome heading. */
export const SECTION_HEADING_CLASS = "text-lg font-bold text-foreground";

/** The intro paragraph under `HEADING_CLASS`. */
export const LEAD_CLASS = "mb-6 text-sm text-muted-foreground";

/** A status message under `HEADING_CLASS` that ends its card or section: lead text, no margin under it. */
export const STATUS_LEAD_CLASS = "mb-0 text-sm text-muted-foreground";

/** The "no account? / have an account?" line under an auth form. */
export const AUTH_FOOTER_CLASS = "mt-4 text-center text-sm text-muted-foreground";

/** The intro paragraph under `HERO_HEADING_CLASS`. */
export const HERO_LEAD_CLASS = "max-w-2xl text-muted-foreground sm:text-lg";

/**
 * A quiet text link (or link-styled native button): token colour, colour change and underline on
 * hover, full-strength focus outline (`--ring` at half alpha is below 3:1 on white).
 */
export const LINK_CLASS =
  "rounded-sm text-primary transition-colors hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** A native `<select>`, matching `Input`: full-strength focus ring and the same disabled look. */
export const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";

/** Keeps the `rows` height of a textarea (the shared `Textarea` grows with its content by default). */
export const FIXED_ROWS = "field-sizing-fixed";

/** Inner surfaces (results, match cards, tickets) as a `Card`: muted fill, compact padding, no shadow. */
export const INNER_CARD = "gap-0 bg-muted p-4 shadow-none";

/**
 * Blocked look for a submit that stays focusable: `aria-disabled` instead of `disabled`, so keyboard
 * focus is not dropped while a request is pending and the reason (`aria-describedby`) is read on focus.
 * The submit handler must still return early while blocked.
 */
export const BLOCKED_CLASS = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
