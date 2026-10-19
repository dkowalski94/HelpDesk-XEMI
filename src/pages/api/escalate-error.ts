import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { escalateUnhelpful } from "@/lib/services/error-resolution";
import type { EscalationFailureReason, EscalationResponse } from "@/types";

const FAILURE_STATUS: Record<EscalationFailureReason, number> = {
  unauthorized: 401,
  "not-a-client": 403,
  "empty-text": 400,
  "too-long": 400,
  "comment-too-long": 400,
  "not-configured": 503,
  error: 500,
};

function json(body: EscalationResponse, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stringField(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Escalates a knowledge base suggestion the client found unhelpful into a ticket (S-03).
 * Gated exactly like `/api/resolve-error`; not in `PROTECTED_ROUTES`, it answers 401 itself.
 */
export const POST: APIRoute = async (context) => {
  // Answered here with a status code, not left to a middleware redirect: a fetch
  // caller follows a 302 and reads the sign-in page as a successful response.
  if (!context.locals.user) {
    return json(
      { ok: false, reason: "unauthorized", error: "Zaloguj się, aby zgłosić błąd." },
      FAILURE_STATUS.unauthorized,
    );
  }

  if (context.locals.profileLookupFailed) {
    return json(
      { ok: false, reason: "error", error: "Nie udało się ustalić Twojego konta. Spróbuj ponownie." },
      FAILURE_STATUS.error,
    );
  }

  // Client users of a client company only.
  const profile = context.locals.profile;
  if (profile?.role !== "client_user" || profile.companyKind !== "client") {
    return json(
      { ok: false, reason: "not-a-client", error: "Zgłaszanie błędów jest dostępne tylko dla klientów." },
      FAILURE_STATUS["not-a-client"],
    );
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json(
      { ok: false, reason: "not-configured", error: "Supabase nie jest skonfigurowany." },
      FAILURE_STATUS["not-configured"],
    );
  }

  let errorText = "";
  let comment = "";
  try {
    const form = await context.request.formData();
    errorText = stringField(form, "errorText");
    comment = stringField(form, "comment");
  } catch {
    // Not a form body — treated like an empty paste (400 empty-text).
  }

  const result = await escalateUnhelpful(
    supabase,
    { userId: context.locals.user.id, companyId: profile.companyId },
    errorText,
    comment,
  );

  return json(result, result.ok ? 200 : FAILURE_STATUS[result.reason]);
};
