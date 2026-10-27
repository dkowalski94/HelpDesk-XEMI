import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { MyTicketsState } from "@/hooks/useMyTickets";
import { cn } from "@/lib/utils";
import type { TicketStatus } from "@/types";
import { CauseSteps } from "./CauseSteps";
import { ErrorAlert } from "./ErrorAlert";
import { FOCUS_RING, formatDate } from "./format";

/** Rows shown while the list loads, so the first rows arriving replace them instead of pushing content down. */
const SKELETON_ROWS = 2;

const STATUS_LABELS: Record<TicketStatus, string> = {
  todo: "Do zrobienia",
  resolved: "Rozwiązane",
};

interface MyTicketsListProps {
  state: MyTicketsState;
  /**
   * The list's own `h2`. `null` omits it, with its top rule, where the page already titles
   * the list (the `/my-tickets` `h1` "Moje zgłoszenia").
   */
  heading?: string | null;
  /** Link to the next, older page; shown as "Starsze zgłoszenia" when given. */
  olderHref?: string;
  /** Link to the previous, newer page; shown as "Nowsze zgłoszenia" when given. */
  newerHref?: string;
}

/**
 * The caller's own tickets: "Twoje zgłoszenia" in the `/report-error` panel (loaded by
 * `useMyTickets`), and the server-rendered list on `/my-tickets`, with page links.
 */
export function MyTicketsList({ state, heading = "Twoje zgłoszenia", olderHref, newerHref }: MyTicketsListProps) {
  return (
    <section
      aria-busy={state.status === "loading"}
      aria-label={heading === null ? "Lista zgłoszeń" : undefined}
      className={cn("min-h-36 space-y-3", heading !== null && "border-border border-t pt-6")}
    >
      {heading !== null && <h2 className="text-foreground text-lg font-semibold">{heading}</h2>}
      {state.status === "loading" && (
        <>
          <p className="sr-only">Wczytywanie...</p>
          <ul aria-hidden="true" className="space-y-2">
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <li key={i}>
                <Card className="bg-muted h-10 animate-pulse rounded-lg py-0 shadow-none" />
              </li>
            ))}
          </ul>
        </>
      )}
      {state.status === "error" && <ErrorAlert message={state.error} />}
      {state.status === "ok" && state.tickets.length === 0 && (
        <p className="text-muted-foreground text-sm">Nie masz jeszcze żadnych zgłoszeń.</p>
      )}
      {state.status === "ok" && state.tickets.length > 0 && (
        <ul className="space-y-2">
          {state.tickets.map((ticket) => (
            <li key={ticket.id}>
              <Card className="bg-muted gap-0 rounded-lg px-3 py-2 shadow-none">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <span className="text-foreground/80 min-w-0 flex-1 truncate text-sm" title={ticket.errorText}>
                    {ticket.errorText}
                  </span>
                  <Badge
                    className={cn(
                      ticket.status === "resolved"
                        ? "bg-success text-success-foreground"
                        : "bg-warning text-warning-foreground",
                    )}
                  >
                    {STATUS_LABELS[ticket.status]}
                  </Badge>
                  <span className="text-muted-foreground shrink-0 text-xs">{formatDate(ticket.createdAt)}</span>
                </div>
                {ticket.status === "resolved" && (
                  <CauseSteps cause={ticket.resolutionCause} steps={ticket.resolution} />
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {(newerHref !== undefined || olderHref !== undefined) && (
        <nav aria-label="Strony zgłoszeń" className="flex flex-wrap gap-2 pt-2">
          {newerHref !== undefined && (
            <Button asChild variant="outline" className={FOCUS_RING}>
              <a href={newerHref}>Nowsze zgłoszenia</a>
            </Button>
          )}
          {olderHref !== undefined && (
            <Button asChild variant="outline" className={cn("ml-auto", FOCUS_RING)}>
              <a href={olderHref}>Starsze zgłoszenia</a>
            </Button>
          )}
        </nav>
      )}
    </section>
  );
}
