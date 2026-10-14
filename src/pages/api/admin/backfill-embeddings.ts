import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { backfillEmbeddings } from "@/lib/services/ticket-resolution";

export const POST: APIRoute = async (context) => {
  // The middleware already gates /api/admin; this check stays so the endpoint does
  // not depend on the route list or on the UI having hidden the button.
  if (context.locals.profile?.role !== "service_staff") {
    return new Response(null, { status: context.locals.user ? 403 : 401 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/admin/tickets?error=not-configured");
  }

  const result = await backfillEmbeddings(supabase);

  // Only the count goes back into the URL, as digits.
  return context.redirect(
    result.status === "ok"
      ? `/admin/tickets?status=backfilled&filled=${String(Math.trunc(result.filled))}`
      : `/admin/tickets?error=${result.status}`,
  );
};
