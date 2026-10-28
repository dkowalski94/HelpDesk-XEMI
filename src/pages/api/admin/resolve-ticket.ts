import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { resolveTicket, staffQueueHref } from "@/lib/services/ticket-resolution";

export const POST: APIRoute = async (context) => {
  // The middleware already gates /api/admin; this check stays so the endpoint does
  // not depend on the route list or on the UI having hidden the form.
  if (context.locals.profile?.role !== "service_staff") {
    return new Response(null, { status: context.locals.user ? 403 : 401 });
  }

  const form = await context.request.formData();
  const ticketId = form.get("ticketId");
  const cause = form.get("cause");
  const steps = form.get("steps");
  // The queue's company filter goes back into the redirect only as a UUID (staffQueueHref
  // drops anything else), so without it the URL is exactly the unfiltered one.
  const companyField = form.get("company");
  const company = typeof companyField === "string" ? companyField : null;

  if (typeof ticketId !== "string" || ticketId === "" || typeof steps !== "string" || steps === "") {
    return context.redirect(staffQueueHref({ company, error: "missing-fields" }));
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(staffQueueHref({ company, error: "not-configured" }));
  }

  const outcome = await resolveTicket(supabase, {
    ticketId,
    cause: typeof cause === "string" ? cause : "",
    steps,
  });

  return context.redirect(
    outcome === "resolved" || outcome === "resolved-no-embedding"
      ? staffQueueHref({ company, status: outcome })
      : staffQueueHref({ company, error: outcome }),
  );
};
