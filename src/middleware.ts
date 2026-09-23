import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { getSessionProfile } from "@/lib/services/profile";

const PROTECTED_ROUTES = ["/dashboard", "/search"];

// Staff-only routes. They are also protected routes, so an anonymous visitor is
// sent to sign in by the check below before the role check ever runs.
const STAFF_ROUTES = ["/admin"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
    // Resolved once per request so pages and endpoints share one identity
    // instead of each re-querying who the user is.
    context.locals.profile = user ? await getSessionProfile(supabase, user.id) : null;
  } else {
    context.locals.user = null;
    context.locals.profile = null;
  }

  const isStaffRoute = STAFF_ROUTES.some((route) => context.url.pathname.startsWith(route));

  if (isStaffRoute || PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  // Signed in but not staff: stop at the boundary rather than letting the page
  // render and rely on RLS to hide everything it asks for.
  if (isStaffRoute && context.locals.profile?.role !== "service_staff") {
    return context.redirect("/dashboard");
  }

  return next();
});
