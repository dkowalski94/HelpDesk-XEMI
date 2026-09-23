import type { APIRoute } from "astro";
import { searchWeb } from "@/lib/services/web-search";
import type { WebSearchFailureReason, WebSearchResponse } from "@/types";

const FAILURE_STATUS: Record<WebSearchFailureReason, number> = {
  unauthorized: 401,
  "empty-query": 400,
  "not-configured": 503,
  upstream: 502,
};

function json(body: WebSearchResponse, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  // Every call spends Exa credits, so the endpoint is for signed-in users only.
  if (!context.locals.user) {
    return json(
      { ok: false, reason: "unauthorized", error: "Sign in to use web search." },
      FAILURE_STATUS.unauthorized,
    );
  }

  const form = await context.request.formData();
  const query = form.get("query") as string | null;

  const result = await searchWeb(query ?? "");

  return json(result, result.ok ? 200 : FAILURE_STATUS[result.reason]);
};
