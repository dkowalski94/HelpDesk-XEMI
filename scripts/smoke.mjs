// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together,
// and that one company's data never reaches another company's users.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs
// The isolation steps expect the demo personas from supabase/seed.sql (`npx supabase db reset`).
//
// Each run files two Klient Alfa tickets as the throwaway account — one through
// POST /api/resolve-error, which staff then resolves (adding one ticket knowledge base
// entry), and one through POST /api/escalate-error, which stays open; nothing deletes
// any of them — tickets have no DELETE policy. After ~24 runs against the
// same database the seeded ticket e101 falls off the first page of GET /api/tickets, and the
// staff check and the three onlyTicketsOf(COMPANY.alfa, TICKET.alfa) steps fail (the open
// escalation tickets also fill the oldest-first staff queue, after ~49 runs): run
// `npx supabase db reset` every couple of dozen local runs.

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const runId = Date.now();
const email = `smoke-${runId}@example.com`;
const password = "Smoke-Test-Passw0rd!";
// Unique per run, and nonsense words so a developer's locally ingested ERP docs do not
// match it — the resolve-error steps expect the no-match path that files a ticket.
// Each run also resolves its ticket into a knowledge base entry. Without OPENAI_API_KEY
// (CI) that entry has no embedding and matches nothing; with the key it is embedded, and
// the next run's text matches it — run `npx supabase db reset` before every such run.
const errorText = `smoke-${runId} ERR-SMOKE kwarblifon zdrumpel wyzgotnik plomboryt`;
// A distinct text for the escalation, so its ticket is not the resolve-error one the S-02
// steps resolve. The comments are plain ASCII so Astro's HTML escaping leaves them intact.
const escalationText = `${errorText} eskalacja`;
const escalationComment = `smoke-${runId} first comment suggestion did not help`;
const escalationSecondComment = `smoke-${runId} second comment still broken`;

// Fixed ids and credentials from supabase/seed.sql. The seeded personas are only ever
// signed in as and attacked — never successfully changed — so a second run against the
// same database sees them exactly as the first did.
const COMPANY = {
  internal: "00000000-0000-0000-0000-00000000c001",
  alfa: "00000000-0000-0000-0000-00000000c101",
  beta: "00000000-0000-0000-0000-00000000c102",
};
const TICKET = {
  alfa: "00000000-0000-0000-0000-00000000e101",
  beta: "00000000-0000-0000-0000-00000000e102",
};
const SEEDED = {
  staff: { id: "00000000-0000-0000-0000-0000000000a1", email: "serwis@xemi.local", password: "Xemi-Service-Passw0rd!" },
  alfa: {
    id: "00000000-0000-0000-0000-0000000000a2",
    email: "alfa@klient-alfa.local",
    password: "Klient-Alfa-Passw0rd!",
  },
  beta: {
    id: "00000000-0000-0000-0000-0000000000a3",
    email: "beta@klient-beta.local",
    password: "Klient-Beta-Passw0rd!",
  },
};

// One cookie jar per persona, so several sessions can be alive at once. "smoke" is the
// throwaway account registered below; "anonymous" never signs in.
const jars = new Map();

function jarFor(persona) {
  if (!jars.has(persona)) jars.set(persona, new Map());
  return jars.get(persona);
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(jar, response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), rest.join("="));
  }
}

async function request(path, { method = "GET", form, as = "smoke" } = {}) {
  const jar = jarFor(as);
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(jar),
      Origin: BASE_URL,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  storeCookies(jar, response);
  const text = await response.text();
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    text,
    json: isJson && text ? JSON.parse(text) : undefined,
  };
}

function signIn(persona) {
  const { email: personaEmail, password: personaPassword } = SEEDED[persona];
  return request("/api/auth/signin", {
    method: "POST",
    form: { email: personaEmail, password: personaPassword },
    as: persona,
  });
}

function assignCompany(as, form) {
  return request("/api/admin/assign-company", { method: "POST", form, as });
}

function resolveError(as, text) {
  return request("/api/resolve-error", { method: "POST", form: { errorText: text }, as });
}

function escalateError(as, text, comment) {
  return request("/api/escalate-error", { method: "POST", form: { errorText: text, comment }, as });
}

function resolveTicket(as, { ticketId, cause = "", steps }) {
  return request("/api/admin/resolve-ticket", { method: "POST", form: { ticketId: ticketId ?? "", cause, steps }, as });
}

/** True when the ticket list is non-empty, belongs entirely to one company, and holds that company's seeded ticket. */
function onlyTicketsOf(companyId, ticketId) {
  return ({ json }) =>
    json?.ok === true &&
    json.tickets.length > 0 &&
    json.tickets.every((ticket) => ticket.companyId === companyId) &&
    json.tickets.some((ticket) => ticket.id === ticketId);
}

/**
 * Finds an account on the staff waiting list (`/admin/users`) and returns its id, read
 * from the hidden `userId` field of the form rendered for it. `null` means the account
 * is not waiting — the list shows only profiles in the unassigned company.
 */
function waitingUserId(html, userEmail) {
  const at = html.indexOf(`>${userEmail}<`);
  if (at === -1) return null;
  const ids = [...html.slice(0, at).matchAll(/name="userId" value="([0-9a-f-]{36})"/g)];
  return ids.at(-1)?.[1] ?? null;
}

// Filled in by the step that reads the waiting list, used by the assignment attempts.
let smokeUserId = null;
// Filled in by the step that files the ticket, used by the steps that look for it.
let smokeTicketId = null;
// Filled in by the step that escalates, used by the duplicate check.
let escalationTicketId = null;

// Distinctive substrings of /report-error, one per server-rendered state. The form's
// instruction is part of the island, which client:load also renders on the server.
const REPORT_PAGE = {
  heading: "Zgłoś błąd z systemu ERP",
  instruction: "tylko treść komunikatu błędu",
  staff: "Ta strona jest przeznaczona dla użytkowników klienta",
  waiting: "Twoje konto czeka na przypisanie do firmy",
};

/** True when the staff queue page renders a resolve form for the ticket. */
const inQueue = (html, id) => id !== null && html.includes(`name="ticketId" value="${id}"`);
const hasTicket = (json, id) => id !== null && json.tickets.some((ticket) => ticket.id === id);
const ticketOf = (json, id) =>
  json?.ok === true && id !== null ? json.tickets.find((ticket) => ticket.id === id) : undefined;

// What staff records on the smoke ticket; read back by the filing account.
const resolutionCause = `smoke-${runId} przyczyna`;
const resolutionSteps = `smoke-${runId} kroki: 1. Zamknij okno. 2. Otwórz je ponownie.`;

// "Is the throwaway account still waiting?" is the re-read for every attempt aimed at
// it: the waiting list is exactly the profiles in the unassigned company, so the account
// still being listed under the same id proves its company_id did not change.
const stillWaiting = (actual) => smokeUserId !== null && waitingUserId(actual.text, email) === smokeUserId;

const steps = [
  ["home renders", () => request("/"), { status: 200 }],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  ["admin page redirects anonymous user", () => request("/admin/users"), { status: 302, location: "/auth/signin" }],
  // Asserts the middleware gate, not the endpoint's own role check: the 401 comes
  // from STAFF_ROUTES before the handler runs.
  ["admin api rejects anonymous user", () => request("/api/admin/assign-company", { method: "POST" }), { status: 401 }],
  [
    "report-error page redirects anonymous user",
    () => request("/report-error", { as: "anonymous" }),
    { status: 302, location: "/auth/signin" },
  ],
  ["tickets api rejects anonymous user", () => request("/api/tickets", { as: "anonymous" }), { status: 401 }],
  [
    "resolve-error api rejects anonymous user",
    () => resolveError("anonymous", errorText),
    { status: 401, check: ({ json }) => json?.reason === "unauthorized" },
  ],
  [
    "escalate-error api rejects anonymous user",
    () => escalateError("anonymous", escalationText, escalationComment),
    { status: 401, check: ({ json }) => json?.reason === "unauthorized" },
  ],
  [
    "signup creates account",
    () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
    { status: 302, location: "/auth/confirm-email" },
  ],
  [
    "signin rejects wrong password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } }),
    { status: 302, location: "/auth/signin?error=" },
  ],
  [
    "signin accepts correct password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/" },
  ],
  ["dashboard renders for signed-in user", () => request("/dashboard"), { status: 200 }],
  ["signout clears session", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],

  // --- Read isolation: GET /api/tickets returns exactly what RLS permits -------------
  ["Klient Alfa user signs in", () => signIn("alfa"), { status: 302, location: "/" }],
  [
    "Klient Alfa user sees only Alfa's tickets",
    () => request("/api/tickets", { as: "alfa" }),
    { status: 200, check: onlyTicketsOf(COMPANY.alfa, TICKET.alfa) },
  ],
  [
    "Klient Alfa user gets the report-error form",
    () => request("/report-error", { as: "alfa" }),
    {
      status: 200,
      check: ({ text }) => text.includes(REPORT_PAGE.heading) && text.includes(REPORT_PAGE.instruction),
    },
  ],
  ["Klient Beta user signs in", () => signIn("beta"), { status: 302, location: "/" }],
  [
    "Klient Beta user sees only Beta's tickets",
    () => request("/api/tickets", { as: "beta" }),
    { status: 200, check: onlyTicketsOf(COMPANY.beta, TICKET.beta) },
  ],
  ["staff signs in", () => signIn("staff"), { status: 302, location: "/" }],
  [
    "staff sees both companies' tickets",
    () => request("/api/tickets", { as: "staff" }),
    {
      status: 200,
      check: ({ json }) =>
        json?.ok === true &&
        json.nextOffset === null &&
        [TICKET.alfa, TICKET.beta].every((id) => json.tickets.some((ticket) => ticket.id === id)),
    },
  ],
  [
    "staff cannot file an error through resolve-error",
    () => resolveError("staff", errorText),
    { status: 403, check: ({ json }) => json?.reason === "not-a-client" },
  ],
  [
    "staff cannot escalate through escalate-error",
    () => escalateError("staff", escalationText, escalationComment),
    { status: 403, check: ({ json }) => json?.reason === "not-a-client" },
  ],
  [
    "staff gets the staff message on /report-error, not the form",
    () => request("/report-error", { as: "staff" }),
    {
      status: 200,
      check: ({ text }) => text.includes(REPORT_PAGE.staff) && !text.includes(REPORT_PAGE.instruction),
    },
  ],
  [
    "new account signs in again",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/" },
  ],
  [
    "unassigned account sees no tickets",
    () => request("/api/tickets"),
    { status: 200, check: ({ json }) => json?.ok === true && json.tickets.length === 0 },
  ],
  [
    "unassigned account cannot file an error through resolve-error",
    () => resolveError("smoke", errorText),
    { status: 403, check: ({ json }) => json?.reason === "not-a-client" },
  ],
  [
    "unassigned account cannot escalate through escalate-error",
    () => escalateError("smoke", escalationText, escalationComment),
    { status: 403, check: ({ json }) => json?.reason === "not-a-client" },
  ],
  [
    "unassigned account gets the waiting message on /report-error, not the form",
    () => request("/report-error"),
    {
      status: 200,
      check: ({ text }) => text.includes(REPORT_PAGE.waiting) && !text.includes(REPORT_PAGE.instruction),
    },
  ],

  // --- Write and escalation attempts: each is rejected, then state is re-read --------
  [
    "staff reaches /admin/users and sees the new account waiting",
    async () => {
      const actual = await request("/admin/users", { as: "staff" });
      smokeUserId = waitingUserId(actual.text, email);
      return actual;
    },
    { status: 200, check: () => smokeUserId !== null },
  ],
  [
    "client user cannot assign a company",
    () => assignCompany("alfa", { userId: smokeUserId, companyId: COMPANY.alfa }),
    { status: 403 },
  ],
  [
    "...and the new account is still waiting",
    () => request("/admin/users", { as: "staff" }),
    { status: 200, check: stillWaiting },
  ],
  [
    "client user cannot move itself to another company",
    () => assignCompany("alfa", { userId: SEEDED.alfa.id, companyId: COMPANY.beta }),
    { status: 403 },
  ],
  // Moved to Beta, the same user would see Beta's ticket instead of Alfa's.
  [
    "...and still sees only Alfa's tickets",
    () => request("/api/tickets", { as: "alfa" }),
    { status: 200, check: onlyTicketsOf(COMPANY.alfa, TICKET.alfa) },
  ],
  [
    "staff cannot assign an account to the internal company",
    () => assignCompany("staff", { userId: smokeUserId, companyId: COMPANY.internal }),
    { status: 302, location: "/admin/users?error=invalid-company" },
  ],
  [
    "...and the new account is still waiting",
    () => request("/admin/users", { as: "staff" }),
    { status: 200, check: stillWaiting },
  ],
  [
    "client user cannot smuggle role=service_staff into an assignment",
    () => assignCompany("alfa", { userId: SEEDED.alfa.id, companyId: COMPANY.alfa, role: "service_staff" }),
    { status: 403 },
  ],
  // A service_staff profile would reach /admin/users; the dashboard names role and company.
  [
    "...and is still turned away from /admin/users",
    () => request("/admin/users", { as: "alfa" }),
    { status: 302, location: "/dashboard" },
  ],
  [
    "...and the dashboard still says Client user at Klient Alfa",
    () => request("/dashboard", { as: "alfa" }),
    { status: 200, check: ({ text }) => text.includes("Client user") && text.includes("Klient Alfa") },
  ],
  [
    "unassigned account is redirected away from /admin/users",
    () => request("/admin/users"),
    { status: 302, location: "/dashboard" },
  ],

  // --- The one successful write: staff assigns the throwaway account -----------------
  // Reaches assign-company.ts itself (every attempt above stops at the middleware), and
  // carries a smuggled role field the endpoint must ignore. Also drains the waiting list.
  [
    "staff assigns the new account to Klient Alfa, ignoring a smuggled role=service_staff",
    () => assignCompany("staff", { userId: smokeUserId, companyId: COMPANY.alfa, role: "service_staff" }),
    { status: 302, location: "/admin/users?status=assigned" },
  ],
  [
    "...and the account has left the waiting list",
    () => request("/admin/users", { as: "staff" }),
    { status: 200, check: ({ text }) => smokeUserId !== null && waitingUserId(text, email) === null },
  ],
  [
    "...and now sees only Alfa's tickets",
    () => request("/api/tickets"),
    { status: 200, check: onlyTicketsOf(COMPANY.alfa, TICKET.alfa) },
  ],
  [
    "...and its dashboard says Client user at Klient Alfa",
    () => request("/dashboard"),
    { status: 200, check: ({ text }) => text.includes("Client user") && text.includes("Klient Alfa") },
  ],
  [
    "...and it is still turned away from /admin/users",
    () => request("/admin/users"),
    { status: 302, location: "/dashboard" },
  ],

  // --- Error resolution: the assigned throwaway account files one Alfa ticket ---------
  // CI has no OPENAI_API_KEY, so the search is unavailable and every paste falls back to a
  // ticket; locally, the nonsense text is meant to match nothing either way.
  [
    "resolve-error rejects a blank text",
    () => resolveError("smoke", "   "),
    { status: 400, check: ({ json }) => json?.reason === "empty-text" },
  ],
  [
    "resolve-error rejects a text over 2000 characters",
    () => resolveError("smoke", "x".repeat(2001)),
    { status: 400, check: ({ json }) => json?.reason === "too-long" },
  ],
  [
    "resolve-error files a Klient Alfa ticket for an unmatched error",
    async () => {
      const actual = await resolveError("smoke", errorText);
      smokeTicketId = actual.json?.ticket?.id ?? null;
      return actual;
    },
    {
      status: 200,
      check: ({ json }) =>
        json?.ok === true &&
        json.outcome === "ticket-created" &&
        json.ticket.companyId === COMPANY.alfa &&
        json.ticket.errorText === errorText,
    },
  ],
  [
    "...and the same error again is already reported, as the same ticket",
    () => resolveError("smoke", errorText),
    {
      status: 200,
      check: ({ json }) =>
        json?.ok === true &&
        json.outcome === "already-reported" &&
        smokeTicketId !== null &&
        json.ticket.id === smokeTicketId,
    },
  ],
  [
    "...and ?mine=1 lists exactly that ticket for the new account",
    () => request("/api/tickets?mine=1"),
    {
      status: 200,
      check: ({ json }) => json?.ok === true && json.tickets.length === 1 && hasTicket(json, smokeTicketId),
    },
  ],
  [
    "...and the Klient Alfa user still sees only Alfa's tickets, the new one included",
    () => request("/api/tickets", { as: "alfa" }),
    {
      status: 200,
      check: (actual) => onlyTicketsOf(COMPANY.alfa, TICKET.alfa)(actual) && hasTicket(actual.json, smokeTicketId),
    },
  ],
  [
    "...and ?mine=1 for the Klient Alfa user lists its own ticket, not the new one",
    () => request("/api/tickets?mine=1", { as: "alfa" }),
    {
      status: 200,
      check: ({ json }) =>
        json?.ok === true && hasTicket(json, TICKET.alfa) && smokeTicketId !== null && !hasTicket(json, smokeTicketId),
    },
  ],
  [
    "...and the Klient Beta user does not see it",
    () => request("/api/tickets", { as: "beta" }),
    {
      status: 200,
      check: ({ json }) => json?.ok === true && smokeTicketId !== null && !hasTicket(json, smokeTicketId),
    },
  ],

  // --- Suggestion escalation (S-03): the same account escalates a distinct text -------
  // Gate checks for anonymous, staff and unassigned callers sit next to resolve-error's above.
  [
    "escalate-error rejects a blank text",
    () => escalateError("smoke", "   ", escalationComment),
    { status: 400, check: ({ json }) => json?.reason === "empty-text" },
  ],
  [
    "escalate-error rejects a comment over 1000 characters",
    () => escalateError("smoke", escalationText, "x".repeat(1001)),
    { status: 400, check: ({ json }) => json?.reason === "comment-too-long" },
  ],
  [
    "escalate-error files a Klient Alfa ticket with the comment",
    async () => {
      const actual = await escalateError("smoke", escalationText, escalationComment);
      escalationTicketId = actual.json?.ticket?.id ?? null;
      return actual;
    },
    {
      status: 200,
      check: ({ json }) =>
        json?.ok === true &&
        json.outcome === "ticket-created" &&
        json.ticket.companyId === COMPANY.alfa &&
        json.ticket.errorText === escalationText,
    },
  ],
  [
    "...and escalating the same text with another comment is already reported, as the same ticket",
    () => escalateError("smoke", escalationText, escalationSecondComment),
    {
      status: 200,
      check: ({ json }) =>
        json?.ok === true &&
        json.outcome === "already-reported" &&
        escalationTicketId !== null &&
        json.ticket.id === escalationTicketId,
    },
  ],
  // Assumes the escalation ticket is on the queue's first, oldest-first page; see the header.
  [
    "...and staff sees the first comment on /admin/tickets, not the second",
    () => request("/admin/tickets", { as: "staff" }),
    {
      status: 200,
      check: ({ text }) => text.includes(escalationComment) && !text.includes(escalationSecondComment),
    },
  ],

  // --- Ticket resolution (S-02): staff resolves the ticket filed above ---------------
  // Both endpoints are rejected for anonymous and client callers first, then the ticket is
  // re-read as still open. CI has no OPENAI_API_KEY, so the resolution is saved without an
  // embedding there (status=resolved-no-embedding); with a key it is status=resolved.
  [
    "resolve-ticket api rejects anonymous user",
    () => resolveTicket("anonymous", { ticketId: smokeTicketId, steps: resolutionSteps }),
    { status: 401 },
  ],
  [
    "client user cannot resolve a ticket",
    () => resolveTicket("alfa", { ticketId: smokeTicketId, cause: "smoke", steps: resolutionSteps }),
    { status: 403 },
  ],
  [
    "the filing account cannot resolve its own ticket",
    () => resolveTicket("smoke", { ticketId: smokeTicketId, steps: resolutionSteps }),
    { status: 403 },
  ],
  [
    "...and the ticket is still open",
    () => request("/api/tickets?mine=1"),
    { status: 200, check: ({ json }) => ticketOf(json, smokeTicketId)?.status === "todo" },
  ],
  [
    "backfill-embeddings api rejects anonymous user",
    () => request("/api/admin/backfill-embeddings", { method: "POST", as: "anonymous" }),
    { status: 401 },
  ],
  [
    "client user cannot run the embedding backfill",
    () => request("/api/admin/backfill-embeddings", { method: "POST", as: "alfa" }),
    { status: 403 },
  ],
  [
    "client user is turned away from /admin/tickets",
    () => request("/admin/tickets", { as: "alfa" }),
    { status: 302, location: "/dashboard" },
  ],
  // Assumes the smoke ticket is on the queue's first, oldest-first page; see the header.
  [
    "staff queue at /admin/tickets lists the ticket",
    () => request("/admin/tickets", { as: "staff" }),
    { status: 200, check: ({ text }) => inQueue(text, smokeTicketId) },
  ],
  [
    "staff cannot resolve with blank steps",
    () => resolveTicket("staff", { ticketId: smokeTicketId, steps: "   " }),
    { status: 302, location: "/admin/tickets?error=invalid" },
  ],
  [
    "staff resolves the ticket",
    () => resolveTicket("staff", { ticketId: smokeTicketId, cause: resolutionCause, steps: resolutionSteps }),
    {
      status: 302,
      check: ({ location }) => /^\/admin\/tickets\?status=resolved(-no-embedding)?$/.test(location),
    },
  ],
  [
    "...and resolving it again reports it already resolved",
    () => resolveTicket("staff", { ticketId: smokeTicketId, cause: resolutionCause, steps: resolutionSteps }),
    { status: 302, location: "/admin/tickets?error=already-resolved" },
  ],
  [
    "...and it has left the staff queue",
    () => request("/admin/tickets", { as: "staff" }),
    { status: 200, check: ({ text }) => smokeTicketId !== null && !inQueue(text, smokeTicketId) },
  ],
  [
    "...and the filing account sees it resolved, with the cause and steps",
    () => request("/api/tickets?mine=1"),
    {
      status: 200,
      check: ({ json }) => {
        const ticket = ticketOf(json, smokeTicketId);
        return (
          ticket?.status === "resolved" &&
          ticket.resolution === resolutionSteps &&
          ticket.resolutionCause === resolutionCause &&
          ticket.resolvedAt !== null
        );
      },
    },
  ],
];

// A bare path must match exactly: "/" as a prefix would also accept /auth/signin?error=….
// An expectation carrying a query string is a prefix, because the value after it varies
// (e.g. Supabase's error message).
function locationMatches(actual, expected) {
  return expected.includes("?") ? actual.startsWith(expected) : actual === expected;
}

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const ok =
    actual.status === expected.status &&
    (expected.location === undefined || locationMatches(actual.location, expected.location)) &&
    (expected.check === undefined || expected.check(actual));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (!ok) {
    failed++;
    console.log(
      `      expected ${expected.status} ${expected.location ?? ""}${expected.check ? " (+ content check)" : ""}`,
    );
    if (expected.check)
      console.log(`      got ${actual.json ? JSON.stringify(actual.json) : actual.text.slice(0, 300)}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
