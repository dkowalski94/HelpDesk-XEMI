import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TicketStatus, TicketSummary } from "@/types";
import { CauseSteps } from "./CauseSteps";
import { ErrorAlert } from "./ErrorAlert";
import { FOCUS_RING, formatDate } from "./format";

const STATUS_LABELS: Record<TicketStatus, string> = {
  todo: "Do zrobienia",
  resolved: "Rozwiązane",
};

/** The server-rendered list: the caller's tickets, or why they could not be read. */
export type MyTicketsState = { status: "ok"; tickets: TicketSummary[] } | { status: "error"; error: string };

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
 * The caller's own tickets, server-rendered on `/my-tickets` (no hydration), with page links.
 */
export function MyTicketsList({ state, heading = "Twoje zgłoszenia", olderHref, newerHref }: MyTicketsListProps) {
  return (
    <section
      aria-label={heading === null ? "Lista zgłoszeń" : undefined}
      className={cn("space-y-3", heading !== null && "border-border border-t pt-6")}
    >
      {heading !== null && <h2 className="text-foreground text-lg font-semibold">{heading}</h2>}
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
