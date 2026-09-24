// Cuts a document's per-page text into overlapping fragments of roughly 800 tokens.
// Pure and offline: the same pages always produce the same fragments, so --dry-run shows
// exactly what a real load would store.

/** Upper bound of a fragment, in characters (~800 tokens). */
export const MAX_FRAGMENT_CHARS = 3200;
/** How much of the previous fragment's end is repeated at the start of the next one. */
export const OVERLAP_CHARS = 400;
/** Fragments shorter than this are merged into the previous one, or dropped if there is none. */
export const MIN_FRAGMENT_CHARS = 80;

// A break is looked for only in the second half of the window, so no fragment except the
// last one is shorter than half the maximum.
const MIN_BREAK_OFFSET = MAX_FRAGMENT_CHARS / 2;
const PAGE_SEPARATOR = "\n\n";

/**
 * Joins the pages into one text and remembers where each page starts, so a character offset
 * can be mapped back to its page number. Pages without text (screenshots only) contribute
 * nothing and never appear in a label.
 */
function joinPages(pages) {
  const starts = []; // offset in `text` where the page begins
  const numbers = []; // 1-based page number of that entry
  let text = "";
  pages.forEach((pageText, index) => {
    if (!pageText) return;
    if (text) text += PAGE_SEPARATOR;
    starts.push(text.length);
    numbers.push(index + 1);
    text += pageText;
  });
  return { text, starts, numbers };
}

/** Page number of the character at `offset` (a separator belongs to the page before it). */
function pageAt(layout, offset) {
  let low = 0;
  let high = layout.starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (layout.starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return layout.numbers[low];
}

const isSpace = (char) => char === " " || char === "\n";
const isSentenceEnd = (char) => char === "." || char === "!" || char === "?" || char === "…";

/**
 * Where to end a fragment that starts at `start` and may not pass `limit`: the last paragraph
 * break, else the last sentence end, else the last space in the second half of the window.
 * A single "word" longer than half a fragment (a URL, a table row without spaces) is cut hard.
 */
function findBreak(text, start, limit) {
  const earliest = start + MIN_BREAK_OFFSET;

  const paragraph = text.lastIndexOf(PAGE_SEPARATOR, limit - PAGE_SEPARATOR.length);
  if (paragraph >= earliest) return paragraph;

  for (let i = limit - 1; i >= earliest; i--) {
    if (isSentenceEnd(text[i]) && isSpace(text[i + 1] ?? " ")) return i + 1;
  }

  for (let i = limit; i >= earliest; i--) {
    if (isSpace(text[i])) return i;
  }

  return limit;
}

/** First offset at or after `offset` that starts a word, so an overlap never begins mid-word. */
function nextWordStart(text, offset) {
  if (offset === 0 || isSpace(text[offset - 1])) return offset;
  let i = offset;
  while (i < text.length && !isSpace(text[i])) i++;
  while (i < text.length && isSpace(text[i])) i++;
  return i;
}

/**
 * @param {string[]} pages per-page text as returned by `extractPages` (`pages[i]` is page i+1)
 * @returns {{ seq: number, firstPage: number, lastPage: number, text: string }[]}
 *   `seq` is 0-based and contiguous — the order the fragments are staged in.
 */
export function chunkPages(pages) {
  const layout = joinPages(pages);
  const { text } = layout;
  const ranges = [];

  let start = 0;
  while (start < text.length) {
    let end = text.length;
    if (text.length - start > MAX_FRAGMENT_CHARS) {
      end = findBreak(text, start, start + MAX_FRAGMENT_CHARS);
      // A tail too short to stand alone is kept with this fragment instead of becoming
      // a fragment that is almost all overlap.
      if (text.length - end < MIN_FRAGMENT_CHARS) end = text.length;
    }
    ranges.push([start, end]);
    if (end >= text.length) break;
    // Inside one very long unbroken token the next word may start past `end`; continue from
    // the hard cut then, rather than skip text.
    start = Math.min(nextWordStart(text, Math.max(end - OVERLAP_CHARS, start + 1)), end);
  }

  // Trim each range to its first/last visible character; merge or drop what is too short.
  const trimmed = [];
  for (const [rawStart, rawEnd] of ranges) {
    let from = rawStart;
    let to = rawEnd;
    while (from < to && isSpace(text[from])) from++;
    while (to > from && isSpace(text[to - 1])) to--;
    if (to - from >= MIN_FRAGMENT_CHARS) trimmed.push([from, to]);
    else if (to > from && trimmed.length > 0) trimmed[trimmed.length - 1][1] = Math.max(trimmed.at(-1)[1], to);
  }

  return trimmed.map(([from, to], seq) => ({
    seq,
    firstPage: pageAt(layout, from),
    lastPage: pageAt(layout, to - 1),
    text: text.slice(from, to),
  }));
}

/** A fragment's `error_text`: "Magazyn.pdf — s. 12" or "Magazyn.pdf — s. 12–13". `fileName` is a base name. */
export function fragmentLabel(fileName, { firstPage, lastPage }) {
  return firstPage === lastPage ? `${fileName} — s. ${firstPage}` : `${fileName} — s. ${firstPage}–${lastPage}`;
}
