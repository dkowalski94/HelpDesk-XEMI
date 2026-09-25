import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { resolveError } from "@/lib/services/error-resolution";
import type { ErrorResolutionFailureReason, ErrorResolutionResponse } from "@/types";

const FAILURE_STATUS: Record<ErrorResolutionFailureReason, number> = {
  unauthorized: 401,
  "not-a-client": 403,
  "empty-text": 400,
  "too-long": 400,
  "not-configured": 503,
  error: 500,
};

function json(body: ErrorResolutionResponse, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

  // Client users of a client company only — checked before anything spends OpenAI credits.
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

  const form = await context.request.formData();
  const errorText = form.get("errorText") as string | null;

  const result = await resolveError(
    supabase,
    { userId: context.locals.user.id, companyId: profile.companyId },
    errorText ?? "",
  );

  return json(result, result.ok ? 200 : FAILURE_STATUS[result.reason]);
};
