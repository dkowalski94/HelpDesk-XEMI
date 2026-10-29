import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { signupErrorCode } from "@/lib/auth-messages";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email");
  const password = form.get("password");

  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    return context.redirect("/auth/signup?error=missing-fields");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/auth/signup?error=not-configured");
  }
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    const code = signupErrorCode(error);
    if (code === "unknown") {
      console.error(`Sign-up failed with an unmapped Supabase error: code=${error.code} status=${error.status}`);
    }
    return context.redirect(`/auth/signup?error=${code}`);
  }

  return context.redirect("/auth/confirm-email");
};
