/** Polish date and time, in Polish time on both the UTC Worker and the browser. */
export function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" });
}

/** Full-strength focus ring on the view's controls: `--ring` at half alpha is below 3:1 on white (tokens.md). */
export const FOCUS_RING = "focus-visible:border-ring focus-visible:ring-ring";

/** Keeps the `rows` height of the view's textareas (the shared `Textarea` grows with its content by default). */
export const FIXED_ROWS = "field-sizing-fixed";

/** Inner surfaces (results, match cards, tickets) as a `Card`: muted fill, compact padding, no shadow. */
export const INNER_CARD = "gap-0 bg-muted p-4 shadow-none";

/**
 * Blocked look for a submit that stays focusable: `aria-disabled` instead of `disabled`, so keyboard
 * focus is not dropped while a request is pending and the reason (`aria-describedby`) is read on focus.
 * The submit handler must still return early while blocked.
 */
export const BLOCKED_CLASS = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
