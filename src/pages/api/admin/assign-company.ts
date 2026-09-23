import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { assignCompany } from "@/lib/services/company-assignment";

export const POST: APIRoute = async (context) => {
  // The middleware already gates /api/admin; this check stays so the endpoint does
  // not depend on the route list or on the UI having hidden the form.
  if (context.locals.profile?.role !== "service_staff") {
    return new Response(null, { status: context.locals.user ? 403 : 401 });
  }

  const form = await context.request.formData();
  const userId = form.get("userId");
  const companyId = form.get("companyId");

  if (typeof userId !== "string" || userId === "" || typeof companyId !== "string" || companyId === "") {
    return context.redirect("/admin/users?error=missing-fields");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/admin/users?error=not-configured");
  }

  const status = await assignCompany(supabase, userId, companyId);

  return context.redirect(status === "assigned" ? "/admin/users?status=assigned" : `/admin/users?error=${status}`);
};
