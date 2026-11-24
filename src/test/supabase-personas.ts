import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";
import { listTodoQueue } from "@/lib/services/ticket-resolution";
import type { StaffQueueTicket } from "@/types";

/**
 * Seeded sessions for tests that run against the local Supabase. Deliberately does not
 * import `@/lib/supabase` (it reads `astro:env/server`): it builds a plain
 * `@supabase/supabase-js` client with the publishable/anon key and signs in as a
 * seeded persona — never `service_role`.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

const START_HINT =
  "Start the local Supabase with `npx supabase start` (then `npx supabase db reset` for the seeded personas) " +
  "and put its URL and anon/publishable key in `.env` as SUPABASE_URL and SUPABASE_KEY.";

/**
 * Reads and checks the connection settings. Throws instead of skipping: a skipped test
 * is a silent pass, and a non-local URL would write test tickets to a hosted database.
 */
function supabaseEnv(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error(`SUPABASE_URL and SUPABASE_KEY are required for these tests. ${START_HINT}`);
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`SUPABASE_URL is not a valid URL. ${START_HINT}`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `SUPABASE_URL points at "${host}"; these tests write tickets and run only against a local Supabase ` +
        `(localhost or 127.0.0.1). ${START_HINT}`,
    );
  }
  return { url, key };
}

// Fixed ids and credentials from supabase/seed.sql (the same values as scripts/smoke.mjs).
export const COMPANY = {
  alfa: "00000000-0000-0000-0000-00000000c101",
  beta: "00000000-0000-0000-0000-00000000c102",
} as const;

export const PERSONA = {
  staff: { id: "00000000-0000-0000-0000-0000000000a1", email: "serwis@xemi.local", password: "Xemi-Service-Passw0rd!" },
  alfa: {
    id: "00000000-0000-0000-0000-0000000000a2",
    email: "alfa@klient-alfa.local",
    password: "Klient-Alfa-Passw0rd!",
  },
} as const;

export type Persona = keyof typeof PERSONA;

/** A fresh client signed in as the seeded persona; throws when the sign-in fails. */
export async function signInAs(persona: Persona): Promise<SupabaseClient<Database>> {
  const { url, key } = supabaseEnv();
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { email, password } = PERSONA[persona];
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Sign-in as "${persona}" (${email}) failed: ${error.message}. ${START_HINT}`);
  }
  return client;
}

/** Upper bound on queue pages walked, so a paging bug fails instead of looping. */
const MAX_QUEUE_PAGES = 200;

/**
 * Finds a ticket in the staff queue by id, walking every page the way `/admin/tickets`
 * does. `staff` must be a staff session. `null` means it is not in the `todo` queue.
 */
export async function findInStaffQueue(
  staff: SupabaseClient<Database>,
  ticketId: string,
  { companyId }: { companyId?: string | null } = {},
): Promise<StaffQueueTicket | null> {
  let offset: number | null = 0;
  for (let page = 0; offset !== null; page++) {
    if (page >= MAX_QUEUE_PAGES) {
      throw new Error(`Staff queue still has pages after ${MAX_QUEUE_PAGES}; giving up looking for ${ticketId}.`);
    }

    const result = await listTodoQueue(staff, { offset, companyId });
    if (result.status === "error") {
      throw new Error(`Staff queue lookup failed at offset ${offset}.`);
    }

    const found = result.tickets.find((ticket) => ticket.id === ticketId);
    if (found) {
      return found;
    }
    offset = result.nextOffset;
  }
  return null;
}
