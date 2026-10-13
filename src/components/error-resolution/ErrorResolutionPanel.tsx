import React, { useState } from "react";
import { BookOpen, Loader2, Send, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { ERROR_TEXT_MAX_LENGTH } from "@/lib/error-text";
import { useMyTickets } from "@/hooks/useMyTickets";
import type { ErrorResolutionResponse, ErrorResolutionSuccess, KnowledgeMatch, TicketStatus } from "@/types";

const STATUS_LABELS: Record<TicketStatus, string> = {
  todo: "Do zrobienia",
  resolved: "Rozwiązane",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short" });
}

function MatchCard({ match }: { match: KnowledgeMatch }) {
  if (match.source === "erp_doc") {
    return (
      <li className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-purple-200 uppercase">
          <BookOpen className="size-4" />Z dokumentacji ERP
        </p>
        <p className="mt-1 text-xs text-blue-100/50">Źródło: {match.errorText}</p>
        {match.steps && <p className="mt-3 text-sm whitespace-pre-line text-blue-100/80">{match.steps}</p>}
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-purple-200 uppercase">
        <Wrench className="size-4" />Z rozwiązanych zgłoszeń
      </p>
      <p className="mt-1 text-sm whitespace-pre-line text-blue-100/60">{match.errorText}</p>
      {match.cause && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-white">Przyczyna</p>
          <p className="mt-1 text-sm whitespace-pre-line text-blue-100/80">{match.cause}</p>
        </div>
      )}
      {match.steps && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-white">Kroki</p>
          <p className="mt-1 text-sm whitespace-pre-line text-blue-100/80">{match.steps}</p>
        </div>
      )}
    </li>
  );
}

function Outcome({ result }: { result: ErrorResolutionSuccess }) {
  if (result.outcome === "matched") {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-emerald-200">Znaleźliśmy możliwe rozwiązanie</h2>
        <p className="text-sm text-blue-100/60">
          Nie utworzyliśmy zgłoszenia. Jeśli poniższe wskazówki nie pomogą, skontaktuj się z zespołem serwisowym.
        </p>
        <ul className="space-y-4">
          {result.matches.map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </ul>
      </section>
    );
  }

  if (result.outcome === "ticket-created") {
    return (
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-lg font-semibold text-amber-200">Nie znaleźliśmy rozwiązania</h2>
        <p className="mt-1 text-sm text-blue-100/80">Przekazaliśmy błąd do zespołu serwisowego XEMI.</p>
        {result.searchUnavailable && (
          <p className="mt-2 text-sm text-blue-100/60">
            Wyszukiwanie rozwiązań było chwilowo niedostępne, dlatego zgłoszenie trafiło od razu do serwisu.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h2 className="text-lg font-semibold text-amber-200">Ten błąd został już zgłoszony</h2>
      <p className="mt-1 text-sm text-blue-100/80">
        Zgłoszenie z {formatDate(result.ticket.createdAt)} czeka na zespół serwisowy.
      </p>
    </section>
  );
}

export default function ErrorResolutionPanel() {
  const [errorText, setErrorText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ErrorResolutionSuccess | null>(null);
  const { state: myTickets, reload } = useMyTickets();

  const length = errorText.trim().length;
  const tooLong = length > ERROR_TEXT_MAX_LENGTH;
  const blocked = pending || length === 0 || tooLong;

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked) return;

    setPending(true);
    setError(null);
    setResult(null);

    // FormData, not JSON: the endpoint reads a form body and treats anything else as empty.
    const body = new FormData();
    body.set("errorText", errorText);

    try {
      const response = await fetch("/api/resolve-error", { method: "POST", body });
      // A non-JSON body (e.g. an HTML 502 page) means the server was reached but failed.
      const payload = (await response.json().catch(() => null)) as ErrorResolutionResponse | null;
      if (!payload) {
        setError("Wystąpił błąd serwera. Spróbuj ponownie za chwilę.");
      } else if (payload.ok) {
        setResult(payload);
        if (payload.outcome !== "matched") reload();
      } else {
        setError(payload.error);
      }
    } catch {
      setError("Nie udało się połączyć z serwerem. Spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-2">
        <label htmlFor="errorText" className="block text-sm font-semibold text-white">
          Treść komunikatu błędu
        </label>
        <p id="errorText-hint" className="text-sm text-blue-100/60">
          Skopiuj z okna błędu ERP tylko treść komunikatu błędu — bez całego logu ani zrzutu ekranu.
        </p>
        <textarea
          id="errorText"
          name="errorText"
          rows={6}
          value={errorText}
          aria-describedby="errorText-hint errorText-counter"
          onChange={(e) => {
            setErrorText(e.target.value);
          }}
          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-blue-100/40 focus:border-purple-300/60 focus:outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            id="errorText-counter"
            aria-live="polite"
            className={cn("text-xs", tooLong ? "font-semibold text-red-300" : "text-blue-100/50")}
          >
            {length} / {ERROR_TEXT_MAX_LENGTH}
            {tooLong && " — tekst jest za długi"}
          </p>
          <button
            type="submit"
            disabled={blocked}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm transition-colors",
              blocked ? "cursor-not-allowed opacity-50" : "hover:bg-white/20",
            )}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {pending ? "Szukam rozwiązania..." : "Wyślij"}
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error}
        </p>
      )}

      {result && <Outcome result={result} />}

      <section className="space-y-3 border-t border-white/10 pt-6">
        <h2 className="text-lg font-semibold text-white">Twoje zgłoszenia</h2>
        {myTickets.status === "loading" && <p className="text-sm text-blue-100/60">Wczytywanie...</p>}
        {myTickets.status === "error" && (
          <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            {myTickets.error}
          </p>
        )}
        {myTickets.status === "ok" && myTickets.tickets.length === 0 && (
          <p className="text-sm text-blue-100/60">Nie masz jeszcze żadnych zgłoszeń.</p>
        )}
        {myTickets.status === "ok" && myTickets.tickets.length > 0 && (
          <ul className="space-y-2">
            {myTickets.tickets.map((ticket) => (
              <li
                key={ticket.id}
                className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-blue-100/80" title={ticket.errorText}>
                  {ticket.errorText}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-xs font-semibold",
                    ticket.status === "resolved" ? "text-emerald-200" : "text-amber-200",
                  )}
                >
                  {STATUS_LABELS[ticket.status]}
                </span>
                <span className="shrink-0 text-xs text-blue-100/50">{formatDate(ticket.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
