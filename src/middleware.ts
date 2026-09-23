import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { getSessionProfile } from "@/lib/services/profile";

const PROTECTED_ROUTES = ["/dashboard", "/search"];

// Staff-only routes: the pages and their API twin. /admin is deliberately NOT a
// member of PROTECTED_ROUTES — anonymous visitors are caught by the OR in the
// guard below, before the role check ever runs.
const STAFF_ROUTES = ["/admin", "/api/admin"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
    // Resolved once per request so pages and endpoints share one identity
    // instead of each re-querying who the user is.
    const result = user ? await getSessionProfile(supabase, user.id) : null;
    context.locals.profile = result?.status === "ok" ? result.profile : null;
    // Kept apart from `profile` so a page can tell "we could not look you up"
    // from "you have no company yet" — they need different words on screen.
    context.locals.profileLookupFailed = result?.status === "error";
  } else {
    context.locals.user = null;
    context.locals.profile = null;
    context.locals.profileLookupFailed = false;
  }

  const isStaffRoute = STAFF_ROUTES.some((route) => context.url.pathname.startsWith(route));
  const isApiRoute = context.url.pathname.startsWith("/api/");

  if (isStaffRoute || PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return isApiRoute ? new Response(null, { status: 401 }) : context.redirect("/auth/signin");
    }
  }

  if (isStaffRoute && context.locals.profile?.role !== "service_staff") {
    // Stop at the boundary rather than letting the page render and rely on RLS to
    // hide everything it asks for. A fetch caller follows a 302 and receives HTML
    // with status 200, which reads as success — so API callers get a status code.
    return isApiRoute ? new Response(null, { status: 403 }) : context.redirect("/dashboard");
  }

  return next();
});
