import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { signinErrorCode } from "@/lib/auth-messages";
import { safeNextPath, signinHref } from "@/lib/auth-redirect";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email");
  const password = form.get("password");
  const next = form.get("next");
  // signinHref() and safeNextPath() validate `next` themselves; a non-string becomes "/".
  const nextValue = typeof next === "string" ? next : null;

  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    return context.redirect(signinHref({ error: "missing-fields", next: nextValue }));
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(signinHref({ error: "not-configured", next: nextValue }));
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const code = signinErrorCode(error);
    if (code === "unknown") {
      console.error(`Sign-in failed with an unmapped Supabase error: code=${error.code} status=${error.status}`);
    }
    return context.redirect(signinHref({ error: code, next: nextValue }));
  }

  return context.redirect(safeNextPath(nextValue));
};
