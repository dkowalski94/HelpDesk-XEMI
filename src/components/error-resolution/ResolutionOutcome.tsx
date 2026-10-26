import type React from "react";
import { BookOpen, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ErrorResolutionSuccess, KnowledgeMatch } from "@/types";
import { CauseSteps } from "./CauseSteps";
import { INNER_CARD, formatDate } from "./format";

function SourceLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="text-primary flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
      {icon}
      {children}
    </p>
  );
}

function MatchCard({ match }: { match: KnowledgeMatch }) {
  if (match.source === "erp_doc") {
    return (
      <li>
        <Card className={INNER_CARD}>
          <SourceLabel icon={<BookOpen className="size-4" />}>Z dokumentacji ERP</SourceLabel>
          <p className="text-muted-foreground mt-1 text-xs">Źródło: {match.errorText}</p>
          {match.steps && <p className="text-foreground/80 mt-3 text-sm whitespace-pre-line">{match.steps}</p>}
        </Card>
      </li>
    );
  }

  return (
    <li>
      <Card className={INNER_CARD}>
        <SourceLabel icon={<Wrench className="size-4" />}>Z rozwiązanych zgłoszeń</SourceLabel>
        <p className="text-muted-foreground mt-1 text-sm whitespace-pre-line">{match.errorText}</p>
        <CauseSteps cause={match.cause} steps={match.steps} />
      </Card>
    </li>
  );
}

interface ResolutionOutcomeProps {
  result: ErrorResolutionSuccess;
  /** Rendered under the matches (the stateful escalation control); ignored for the other outcomes. */
  escalation?: React.ReactNode;
}

/** What `/api/resolve-error` did with a paste: matched entries, a new ticket, or the caller's open one. */
export function ResolutionOutcome({ result, escalation }: ResolutionOutcomeProps) {
  if (result.outcome === "matched") {
    return (
      <section className="space-y-3">
        <h2 className="text-success text-lg font-semibold">Znaleźliśmy możliwe rozwiązanie</h2>
        <p className="text-muted-foreground text-sm">Nie utworzyliśmy zgłoszenia.</p>
        <ul className="space-y-4">
          {result.matches.map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </ul>
        {escalation}
      </section>
    );
  }

  if (result.outcome === "ticket-created") {
    return (
      <Card className={INNER_CARD}>
        <section>
          <h2 className="text-warning text-lg font-semibold">Nie znaleźliśmy rozwiązania</h2>
          <p className="text-foreground/80 mt-1 text-sm">Przekazaliśmy błąd do zespołu serwisowego XEMI.</p>
          {result.searchUnavailable && (
            <p className="text-muted-foreground mt-2 text-sm">
              Wyszukiwanie rozwiązań było chwilowo niedostępne, dlatego zgłoszenie trafiło od razu do serwisu.
            </p>
          )}
        </section>
      </Card>
    );
  }

  return (
    <Card className={INNER_CARD}>
      <section>
        <h2 className="text-warning text-lg font-semibold">Ten błąd został już zgłoszony</h2>
        <p className="text-foreground/80 mt-1 text-sm">
          Zgłoszenie z {formatDate(result.ticket.createdAt)} czeka na zespół serwisowy.
        </p>
      </section>
    </Card>
  );
}
