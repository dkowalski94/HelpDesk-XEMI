import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { backfillEmbeddings, staffQueueHref } from "@/lib/services/ticket-resolution";

/** The optional `company` form field; a POST without a form body has none. */
async function readCompany(request: Request): Promise<string | null> {
  try {
    const company = (await request.formData()).get("company");
    return typeof company === "string" ? company : null;
  } catch {
    return null;
  }
}

export const POST: APIRoute = async (context) => {
  // The middleware already gates /api/admin; this check stays so the endpoint does
  // not depend on the route list or on the UI having hidden the button.
  if (context.locals.profile?.role !== "service_staff") {
    return new Response(null, { status: context.locals.user ? 403 : 401 });
  }

  // Kept in the redirect only as a UUID (staffQueueHref drops anything else).
  const company = await readCompany(context.request);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(staffQueueHref({ company, error: "not-configured" }));
  }

  const result = await backfillEmbeddings(supabase);

  // Only the count goes back into the URL, as digits.
  return context.redirect(
    result.status === "ok"
      ? staffQueueHref({ company, status: "backfilled", filled: result.filled })
      : staffQueueHref({ company, error: result.status }),
  );
};
