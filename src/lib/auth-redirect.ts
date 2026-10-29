// Dependency-free: imported by the middleware, the sign-in endpoint and the auth pages.
// `safeNextPath()` is the only validation of a `?next=` value — every reader goes
// through it, so an open redirect has exactly one place to be prevented.

const NEXT_MAX_LENGTH = 2048;
const PROBE_ORIGIN = "http://n";
// eslint-disable-next-line no-control-regex -- the point is to reject control characters
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// A path-absolute reference: "/" alone, or "/" followed by neither "/" nor "\" —
// browsers read "//host" and "/\host" as a different host.
const SINGLE_LEADING_SLASH = /^\/(?![/\\])/;
// No loop back to the form and no landing on an endpoint: `/auth`, `/api` and anything
// below them (`/auth/…`, `/api?x`), but not a sibling such as `/authors`.
const FORBIDDEN_PREFIX = /^\/(?:auth|api)(?:[/?#]|$)/i;

function isSafePath(path: string): boolean {
  return SINGLE_LEADING_SLASH.test(path) && !FORBIDDEN_PREFIX.test(path) && !FORBIDDEN_PREFIX.test(decodedPath(path));
}

// Astro decodes the pathname of the next request and collapses duplicate slashes, so
// `/%61pi/…` and `/%2fapi` must count as `/api/…`. A malformed escape cannot route
// anywhere forbidden; the encoded check above still applies.
function decodedPath(path: string): string {
  try {
    return decodeURIComponent(path).replace(/[/\\]+/g, "/");
  } catch {
    return path;
  }
}

/**
 * Returns a same-origin path to send the user to after signing in, or `"/"` when the
 * value is missing or unsafe. The result is the path as normalized by `URL` (dot
 * segments resolved, backslashes turned into slashes), re-checked after normalization,
 * so `/a/..//evil` — which normalizes to `//evil` — is rejected as well.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (value.length === 0 || value.length > NEXT_MAX_LENGTH) return "/";
  if (CONTROL_CHARS.test(value) || !isSafePath(value)) return "/";

  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return "/";
  }
  if (url.origin !== PROBE_ORIGIN) return "/";

  const normalized = `${url.pathname}${url.search}${url.hash}`;
  return isSafePath(normalized) ? normalized : "/";
}

/**
 * Builds the sign-in page URL. `error` goes first, so a redirect after a failed sign-in
 * always starts with `/auth/signin?error=`; `next` is dropped when it is `"/"` or unsafe.
 */
export function signinHref({ next, error }: { next?: string | null; error?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (error) params.set("error", error);
  const safeNext = safeNextPath(next);
  if (safeNext !== "/") params.set("next", safeNext);
  const query = params.toString();
  return query ? `/auth/signin?${query}` : "/auth/signin";
}
