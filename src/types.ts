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

/** `public.user_role` — what a profile is allowed to do. */
export type UserRole = "client_user" | "service_staff";

/**
 * `public.company_kind` — `unassigned` is the sentinel tenant every new account
 * lands in until staff moves it to a real client company.
 */
export type CompanyKind = "client" | "internal" | "unassigned";

/** `public.ticket_status` — the product's loop is file -> resolve, with nothing in between. */
export type TicketStatus = "todo" | "resolved";

/** `public.kb_source` — where a knowledge base entry came from. */
export type KbSource = "ticket" | "erp_doc";

/** A row of `public.companies`. */
export interface Company {
  id: string;
  name: string;
  kind: CompanyKind;
  createdAt: string;
  updatedAt: string;
}

/** A row of `public.profiles`: one per `auth.users` row, created by the signup trigger. */
export interface Profile {
  id: string;
  companyId: string;
  role: UserRole;
  email: string;
  fullName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A row of `public.tickets`.
 *
 * `createdBy` and `resolvedBy` are nullable: both foreign keys are
 * `on delete set null`, so a ticket outlives the account that filed or resolved it.
 */
export interface Ticket {
  id: string;
  companyId: string;
  createdBy: string | null;
  errorText: string;
  userComment: string | null;
  status: TicketStatus;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A row of `public.knowledge_base_entries`. */
export interface KnowledgeBaseEntry {
  id: string;
  source: KbSource;
  errorText: string;
  cause: string | null;
  steps: string | null;
  /** 1536-dimension pgvector column; comes back as a plain array of numbers. */
  embedding: number[] | null;
  sourceTicketId: string | null;
  sourceCompanyId: string | null;
  createdAt: string;
  updatedAt: string;
}

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
