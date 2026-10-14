import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { resolveTicket } from "@/lib/services/ticket-resolution";

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

  if (typeof ticketId !== "string" || ticketId === "" || typeof steps !== "string" || steps === "") {
    return context.redirect("/admin/tickets?error=missing-fields");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/admin/tickets?error=not-configured");
  }

  const outcome = await resolveTicket(supabase, {
    ticketId,
    cause: typeof cause === "string" ? cause : "",
    steps,
  });

  return context.redirect(
    outcome === "resolved" || outcome === "resolved-no-embedding"
      ? `/admin/tickets?status=${outcome}`
      : `/admin/tickets?error=${outcome}`,
  );
};
