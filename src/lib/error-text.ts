/**
 * The longest error text a client may paste, counted on the trimmed text in JS
 * string length. Dependency-free on purpose: the React island imports it, so this
 * module must never import anything that reads `astro:env/server`.
 */
export const ERROR_TEXT_MAX_LENGTH = 2000;

/** The longest comment a client may add when escalating a suggestion, counted the same way. */
export const COMMENT_MAX_LENGTH = 1000;
