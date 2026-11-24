import { beforeEach, describe, expect, it, vi } from "vitest";
import { embedText, EMBEDDING_DIMENSIONS, OpenAIRequestError } from "@/lib/openai";
import { escalateUnhelpful, resolveError } from "@/lib/services/error-resolution";
import { COMPANY, findInStaffQueue, PERSONA, signInAs } from "@/test/supabase-personas";

// Risk #1 (context/foundation/test-plan.md): a ticket the client is told was filed must
// be in the staff queue, and a failed write must be an error with no row. Runs against
// the local Supabase with the seeded personas; only the OpenAI embeddings client is
// mocked. The factory does not load the real module, so `astro:env/server` is never read.
vi.mock("@/lib/openai", () => ({
  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: 1536,
  isOpenAIConfigured: () => true,
  embedText: vi.fn<(text: string) => Promise<number[] | null>>(),
  OpenAIRequestError: class OpenAIRequestError extends Error {
    constructor(
      readonly status: number,
      readonly detail: string,
    ) {
      super(`OpenAI request failed (${status}): ${detail}`);
      this.name = "OpenAIRequestError";
    }
  },
}));

const embed = vi.mocked(embedText);

/** Unit vector e1: the right dimension for `vector(1536)` and non-zero (cosine with zero is NaN). */
const E1 = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index === 0 ? 1 : 0));

// Signed in at load time, so a missing or non-local Supabase fails the file instead of skipping it.
const staff = await signInAs("staff");
const alfa = await signInAs("alfa");

const runId = crypto.randomUUID();
const alfaCaller = { userId: PERSONA.alfa.id, companyId: COMPANY.alfa };

/** A multi-line text unique to this run and case, so the CRLF normalization is exercised. */
function errorTextFor(label: string) {
  return `vitest-${runId} ${label} ERR-VITEST kwarblifon\nlinia 2: zdrumpel wyzgotnik`;
}

async function expectInAlfaQueue(ticketId: string) {
  const queued = await findInStaffQueue(staff, ticketId, { companyId: COMPANY.alfa });
  expect(queued, `ticket ${ticketId} in the staff queue for Klient Alfa`).not.toBeNull();
  expect(queued?.status).toBe("todo");
  expect(queued?.companyId).toBe(COMPANY.alfa);
  return queued;
}

async function expectNoTicketRows(errorText: string) {
  const { data, error } = await staff.from("tickets").select("id").eq("error_text", errorText);
  expect(error).toBeNull();
  expect(data).toEqual([]);
}

beforeEach(() => {
  embed.mockReset();
});

describe("resolveError files a ticket that reaches the staff queue", () => {
  it("files a ticket when a working search finds no match", async () => {
    embed.mockResolvedValue(E1);
    const text = errorTextFor("no-match");

    const result = await resolveError(alfa, alfaCaller, text);

    expect(embed).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, outcome: "ticket-created", searchUnavailable: false });
    if (!result.ok || result.outcome === "matched") throw new Error("expected a filed ticket");
    expect(result.ticket.errorText).toBe(text);
    await expectInAlfaQueue(result.ticket.id);
  });

  it("files a ticket when search is unavailable because no key is configured", async () => {
    embed.mockResolvedValue(null);

    const result = await resolveError(alfa, alfaCaller, errorTextFor("no-key"));

    expect(result).toMatchObject({ ok: true, outcome: "ticket-created", searchUnavailable: true });
    if (!result.ok || result.outcome === "matched") throw new Error("expected a filed ticket");
    await expectInAlfaQueue(result.ticket.id);
  });

  it("files a ticket when search is unavailable because OpenAI fails", async () => {
    embed.mockRejectedValue(new OpenAIRequestError(500, "upstream failure"));

    const result = await resolveError(alfa, alfaCaller, errorTextFor("openai-error"));

    expect(embed).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, outcome: "ticket-created", searchUnavailable: true });
    if (!result.ok || result.outcome === "matched") throw new Error("expected a filed ticket");
    await expectInAlfaQueue(result.ticket.id);
  });

  it("returns the same queued ticket for the same text with CRLF and surrounding spaces", async () => {
    embed.mockResolvedValue(null);
    const text = errorTextFor("duplicate");

    const first = await resolveError(alfa, alfaCaller, text);
    expect(first).toMatchObject({ ok: true, outcome: "ticket-created" });
    if (!first.ok || first.outcome === "matched") throw new Error("expected a filed ticket");

    const again = await resolveError(alfa, alfaCaller, `  ${text.replace(/\n/g, "\r\n")}  \r\n`);

    expect(again).toMatchObject({ ok: true, outcome: "already-reported" });
    if (!again.ok || again.outcome === "matched") throw new Error("expected a reported ticket");
    expect(again.ticket.id).toBe(first.ticket.id);
    await expectInAlfaQueue(first.ticket.id);
  });

  it("returns an error and writes no row when the insert is denied", async () => {
    embed.mockResolvedValue(null);
    const text = errorTextFor("write-denied-resolve");

    // Klient Alfa's session filing for Klient Beta: a real RLS denial of the INSERT.
    const result = await resolveError(alfa, { userId: PERSONA.alfa.id, companyId: COMPANY.beta }, text);

    expect(result).toMatchObject({ ok: false, reason: "error" });
    await expectNoTicketRows(text);
  });
});

describe("escalateUnhelpful files a ticket that reaches the staff queue", () => {
  it("files a ticket with the comment and keeps the first comment on a repeat", async () => {
    const text = errorTextFor("escalation");
    const firstComment = `vitest-${runId} first comment`;
    const secondComment = `vitest-${runId} second comment`;

    const first = await escalateUnhelpful(alfa, alfaCaller, text, firstComment);

    expect(embed).not.toHaveBeenCalled();
    expect(first).toMatchObject({ ok: true, outcome: "ticket-created" });
    if (!first.ok) throw new Error("expected a filed ticket");
    const queued = await expectInAlfaQueue(first.ticket.id);
    expect(queued?.userComment).toBe(firstComment);

    const again = await escalateUnhelpful(alfa, alfaCaller, text, secondComment);

    expect(again).toMatchObject({ ok: true, outcome: "already-reported" });
    if (!again.ok) throw new Error("expected a reported ticket");
    expect(again.ticket.id).toBe(first.ticket.id);
    const stillQueued = await expectInAlfaQueue(first.ticket.id);
    expect(stillQueued?.userComment).toBe(firstComment);
  });

  it("returns an error and writes no row when the insert is denied", async () => {
    embed.mockResolvedValue(null);
    const text = errorTextFor("write-denied-escalation");

    const result = await escalateUnhelpful(
      alfa,
      { userId: PERSONA.alfa.id, companyId: COMPANY.beta },
      text,
      `vitest-${runId} comment`,
    );

    expect(result).toMatchObject({ ok: false, reason: "error" });
    await expectNoTicketRows(text);
  });
});
