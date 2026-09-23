import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { listVisibleTickets } from "@/lib/services/tickets";
import type { TicketListFailureReason, TicketListResponse } from "@/types";

// Read-only for now: the smallest HTTP surface over which tenant isolation can be
// asserted. S-01 and S-02 extend this route rather than replacing it.

const FAILURE_STATUS: Record<TicketListFailureReason, number> = {
  unauthorized: 401,
  "not-configured": 503,
  error: 500,
};

function json(body: TicketListResponse, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async (context) => {
  // Answered here with a status code, not left to a middleware redirect: a fetch
  // caller follows a 302 and reads the sign-in page as a successful response.
  if (!context.locals.user) {
    return json({ ok: false, reason: "unauthorized", error: "Sign in to list tickets." }, FAILURE_STATUS.unauthorized);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json(
      { ok: false, reason: "not-configured", error: "Supabase is not configured." },
      FAILURE_STATUS["not-configured"],
    );
  }

  const tickets = await listVisibleTickets(supabase);
  if (tickets === null) {
    return json({ ok: false, reason: "error", error: "Could not load tickets." }, FAILURE_STATUS.error);
  }

  return json({ ok: true, tickets }, 200);
};
