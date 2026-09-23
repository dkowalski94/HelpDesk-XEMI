import type { Database } from "@/database.types";

/** A single web result returned by the Exa-backed web search tool. */
export interface WebSearchResult {
  id: string;
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  /** Query-relevant passages extracted from the page by Exa. */
  highlights: string[];
}

export interface WebSearchSuccess {
  ok: true;
  query: string;
  results: WebSearchResult[];
}

/** Why a web search could not be answered — the API route maps this to a status code. */
export type WebSearchFailureReason = "unauthorized" | "empty-query" | "not-configured" | "upstream";

export interface WebSearchFailure {
  ok: false;
  reason: WebSearchFailureReason;
  error: string;
}

export type WebSearchResponse = WebSearchSuccess | WebSearchFailure;

/* -------------------------------------------------------------------------- */
/* Identity and tenancy                                                       */
/* -------------------------------------------------------------------------- */

/*
 * Row and enum types are derived from `src/database.types.ts`, which is generated
 * from the live schema with `npx supabase gen types typescript --local`. They are
 * deliberately NOT hand-written: PostgREST returns raw snake_case column names,
 * so a hand-written camelCase "row" type produces code that type-checks and is
 * wrong at every field. Regenerate the file after every migration.
 *
 * DTOs the app defines for itself — `SessionProfile` below, the web-search shapes
 * above — stay hand-written and camelCase. The snake_case boundary ends in the
 * service layer, which maps rows into DTOs.
 */

/** `public.user_role` — what a profile is allowed to do. */
export type UserRole = Database["public"]["Enums"]["user_role"];

/**
 * `public.company_kind` — `unassigned` is the sentinel tenant every new account
 * lands in until staff moves it to a real client company.
 */
export type CompanyKind = Database["public"]["Enums"]["company_kind"];

/** `public.ticket_status` — the product's loop is file -> resolve, with nothing in between. */
export type TicketStatus = Database["public"]["Enums"]["ticket_status"];

/** `public.kb_source` — where a knowledge base entry came from. */
export type KbSource = Database["public"]["Enums"]["kb_source"];

/** A row of `public.companies`. */
export type Company = Database["public"]["Tables"]["companies"]["Row"];

/** A row of `public.profiles`: one per `auth.users` row, created by the signup trigger. */
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * A row of `public.tickets`.
 *
 * `created_by` and `resolved_by` are nullable: both foreign keys are
 * `on delete set null`, so a ticket outlives the account that filed or resolved it.
 */
export type Ticket = Database["public"]["Tables"]["tickets"]["Row"];

/**
 * A row of `public.knowledge_base_entries`.
 *
 * `embedding` is `string | null`, not an array: PostgREST serialises pgvector
 * through the type's text output function, so it arrives as `"[0.1,0.2,…]"` and
 * needs parsing before use.
 */
export type KnowledgeBaseEntry = Database["public"]["Tables"]["knowledge_base_entries"]["Row"];

/** A row of the client-readable `public.knowledge_base_public` view. */
export type KnowledgeBasePublicEntry = Database["public"]["Views"]["knowledge_base_public"]["Row"];

/**
 * The identity the middleware resolves once per request and attaches to
 * `Astro.locals.profile`: who the user is, which tenant they act for, and what
 * that tenant is — enough for every page to gate itself without another query.
 */
export interface SessionProfile {
  id: string;
  email: string;
  role: UserRole;
  companyId: string;
  companyName: string;
  companyKind: CompanyKind;
}

/**
 * The outcome of resolving a session profile, kept distinct from the profile
 * itself: a lookup that failed is not the same thing as a user who has no
 * tenancy, and telling the second story for the first case is a lie the user
 * cannot act on. Mirrors the `WebSearchResponse` union above.
 *
 * `missing` covers both "no profile row yet" and "the company row is not
 * readable" — from the caller's side there is no tenancy either way.
 */
export type SessionProfileResult =
  { status: "ok"; profile: SessionProfile } | { status: "missing" } | { status: "error" };

/* -------------------------------------------------------------------------- */
/* Company assignment (staff)                                                 */
/* -------------------------------------------------------------------------- */

/** An account still sitting in the `unassigned` company, as listed on `/admin/users`. */
export interface PendingAssignmentUser {
  id: string;
  email: string;
  fullName: string | null;
  createdAt: string;
}

/** A `kind = 'client'` company staff can assign an account to. */
export interface ClientCompanyOption {
  id: string;
  name: string;
}

export type PendingAssignmentsResult =
  { status: "ok"; users: PendingAssignmentUser[]; companies: ClientCompanyOption[] } | { status: "error" };

/**
 * Why an assignment did or did not happen — the endpoint forwards it to
 * `/admin/users` as a query parameter, and the page maps it to a fixed message.
 *
 * `not-updated` is the 0-row case: RLS turns a denied update, a `userId` that does
 * not exist, and a user who already has a company into the same silent no-op.
 */
export type AssignCompanyStatus = "assigned" | "invalid-company" | "not-updated" | "error";
