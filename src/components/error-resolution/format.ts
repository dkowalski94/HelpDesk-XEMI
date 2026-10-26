export function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short" });
}

/** Full-strength focus ring on the view's controls: `--ring` at half alpha is below 3:1 on white (tokens.md). */
export const FOCUS_RING = "focus-visible:border-ring focus-visible:ring-ring";

/** Keeps the `rows` height of the view's textareas (the shared `Textarea` grows with its content by default). */
export const FIXED_ROWS = "field-sizing-fixed";

/** Inner surfaces (results, match cards, tickets) as a `Card`: muted fill, compact padding, no shadow. */
export const INNER_CARD = "gap-0 bg-muted p-4 shadow-none";
