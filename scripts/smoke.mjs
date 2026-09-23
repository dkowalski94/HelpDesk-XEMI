// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together,
// and that one company's data never reaches another company's users.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs
// The isolation steps expect the demo personas from supabase/seed.sql (`npx supabase db reset`).

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";

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
  ["tickets api rejects anonymous user", () => request("/api/tickets", { as: "anonymous" }), { status: 401 }],
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
        json?.ok === true && [TICKET.alfa, TICKET.beta].every((id) => json.tickets.some((ticket) => ticket.id === id)),
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
];

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const ok =
    actual.status === expected.status &&
    (expected.location === undefined || actual.location.startsWith(expected.location)) &&
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
