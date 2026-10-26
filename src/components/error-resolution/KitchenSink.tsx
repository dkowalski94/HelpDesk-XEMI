import type React from "react";
import { COMMENT_MAX_LENGTH, ERROR_TEXT_MAX_LENGTH } from "@/lib/error-text";
import type { ErrorResolutionSuccess, KnowledgeMatch, TicketSummary } from "@/types";
import { ErrorTextForm } from "./ErrorTextForm";
import { EscalationControl, type EscalationResult } from "./EscalationControl";
import { MyTicketsList } from "./MyTicketsList";
import { OutcomeRegion } from "./ResolutionOutcome";

/*
 * Dev-only gallery (`/dev/ui-kitchen-sink`): the presentational components of /report-error
 * with static props, one cell per state of the 7-state matrix. No requests; callbacks do nothing.
 */

const noop = () => undefined;
const preventSubmit = (e: React.SubmitEvent<HTMLFormElement>) => {
  e.preventDefault();
};

const SAMPLE_ERROR = "Błąd zapisu dokumentu WZ: brak uprawnień do magazynu „Główny” (kod 4012).";
const TOO_LONG_ERROR = "Ż".repeat(ERROR_TEXT_MAX_LENGTH + 25);
const TOO_LONG_COMMENT = "ą".repeat(COMMENT_MAX_LENGTH + 10);
const CREATED_AT = "2026-10-20T08:15:00.000Z";

const TODO_TICKET: TicketSummary = {
  id: "t-todo",
  companyId: "c-alfa",
  status: "todo",
  errorText: SAMPLE_ERROR,
  createdAt: CREATED_AT,
  resolution: null,
  resolutionCause: null,
  resolvedAt: null,
};

const RESOLVED_TICKET: TicketSummary = {
  id: "t-resolved",
  companyId: "c-alfa",
  status: "resolved",
  errorText:
    "Nie można zaksięgować faktury korygującej, ponieważ okres księgowy wrzesień 2026 jest zamknięty dla tego oddziału.",
  createdAt: "2026-10-12T13:40:00.000Z",
  resolution:
    "1. Otwórz Księgowość → Okresy.\n2. Otwórz okres wrzesień 2026 dla oddziału.\n3. Zaksięguj korektę ponownie.",
  resolutionCause: "Okres zamknięto przed zaksięgowaniem korekty.",
  resolvedAt: "2026-10-13T09:05:00.000Z",
};

const MATCHES: KnowledgeMatch[] = [
  {
    id: "kb-ticket",
    source: "ticket",
    errorText: "Błąd zapisu dokumentu WZ: brak uprawnień do magazynu",
    cause: "Użytkownik nie ma przypisanej roli magazynowej w tym oddziale.",
    steps:
      "1. Administracja → Użytkownicy.\n2. Dodaj rolę „Magazynier” dla magazynu „Główny”.\n3. Zaloguj się ponownie.",
    similarity: 0.91,
  },
  {
    id: "kb-doc",
    source: "erp_doc",
    errorText: "Podręcznik ERP — Uprawnienia.pdf, s. 14",
    cause: null,
    steps: "Uprawnienia do magazynów nadaje administrator w module Administracja, sekcja „Role i dostęp”.",
    similarity: 0.84,
  },
];

const MATCHED: ErrorResolutionSuccess = { ok: true, outcome: "matched", matches: MATCHES };
const MATCHED_EMPTY: ErrorResolutionSuccess = { ok: true, outcome: "matched", matches: [] };
const TICKET_CREATED: ErrorResolutionSuccess = {
  ok: true,
  outcome: "ticket-created",
  ticket: TODO_TICKET,
  searchUnavailable: false,
};
const TICKET_CREATED_NO_SEARCH: ErrorResolutionSuccess = { ...TICKET_CREATED, searchUnavailable: true };
const ALREADY_REPORTED: ErrorResolutionSuccess = {
  ok: true,
  outcome: "already-reported",
  ticket: TODO_TICKET,
  searchUnavailable: false,
};

const ESCALATED: EscalationResult = {
  escalation: { ok: true, outcome: "ticket-created", ticket: TODO_TICKET },
  withComment: true,
};
const ESCALATION_DUPLICATE: EscalationResult = {
  escalation: { ok: true, outcome: "already-reported", ticket: TODO_TICKET },
  withComment: true,
};

function Cell({ state, note, children }: { state: string; note?: string; children?: React.ReactNode }) {
  return (
    <div className="border-border space-y-3 rounded-lg border border-dashed p-4">
      <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{state}</p>
      {note && <p className="text-muted-foreground text-sm">{note}</p>}
      {children}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">{title}</h2>
      <div className="grid gap-4 lg:grid-cols-2">{children}</div>
    </section>
  );
}

interface FormCellProps {
  value: string;
  pending?: boolean;
  error?: string | null;
}

function FormCell({ value, pending = false, error = null }: FormCellProps) {
  const length = value.trim().length;
  return (
    <ErrorTextForm
      value={value}
      length={length}
      pending={pending}
      blocked={pending || length === 0 || length > ERROR_TEXT_MAX_LENGTH}
      error={error}
      onChange={noop}
      onSubmit={preventSubmit}
    />
  );
}

interface EscalationCellProps {
  open?: boolean;
  comment?: string;
  pending?: boolean;
  error?: string | null;
  result?: EscalationResult | null;
}

function EscalationCell({
  open = true,
  comment = "",
  pending = false,
  error = null,
  result = null,
}: EscalationCellProps) {
  const length = comment.trim().length;
  return (
    <EscalationControl
      open={open}
      comment={comment}
      length={length}
      pending={pending}
      blocked={pending || length > COMMENT_MAX_LENGTH}
      error={error}
      result={result}
      onOpen={noop}
      onCommentChange={noop}
      onSubmit={preventSubmit}
    />
  );
}

export default function KitchenSink() {
  return (
    <div className="space-y-10">
      <Group title="Formularz błędu">
        <Cell state="default" note="Wklejony tekst — przycisk aktywny. Hover i focus-visible: Tab na pole i przycisk.">
          <FormCell value={SAMPLE_ERROR} />
        </Cell>
        <Cell state="empty / disabled" note="Puste pole: przycisk zablokowany, powód pod licznikiem.">
          <FormCell value="" />
        </Cell>
        <Cell state="error" note="Tekst ponad limit: aria-invalid, licznik z komunikatem, przycisk zablokowany.">
          <FormCell value={TOO_LONG_ERROR} />
        </Cell>
        <Cell state="error" note="Błąd wysyłki: alert bezpośrednio pod formularzem.">
          <FormCell value={SAMPLE_ERROR} error="Nie udało się połączyć z serwerem. Spróbuj ponownie." />
        </Cell>
        <Cell state="loading" note="Wysyłanie: aria-busy na formularzu, przycisk zablokowany ze spinnerem.">
          <FormCell value={SAMPLE_ERROR} pending />
        </Cell>
      </Group>

      <Group title="Przekazanie do serwisu">
        <Cell state="default" note="Zwinięte: przycisk otwierający formularz.">
          <EscalationCell open={false} />
        </Cell>
        <Cell state="default / empty" note="Komentarz jest opcjonalny — pusty komentarz nie blokuje wysyłki.">
          <EscalationCell comment="" />
        </Cell>
        <Cell state="error" note="Komentarz ponad limit: aria-invalid, przycisk zablokowany.">
          <EscalationCell comment={TOO_LONG_COMMENT} />
        </Cell>
        <Cell state="error" note="Błąd wysyłki: alert wewnątrz formularza.">
          <EscalationCell
            comment="Ponowne logowanie nie pomogło."
            error="Wystąpił błąd serwera. Spróbuj ponownie za chwilę."
          />
        </Cell>
        <Cell state="loading / disabled" note="Wysyłanie: aria-busy, przycisk zablokowany ze spinnerem.">
          <EscalationCell comment="Ponowne logowanie nie pomogło." pending />
        </Cell>
        <Cell state="wynik" note="Zgłoszenie utworzone z komentarzem.">
          <EscalationCell result={ESCALATED} />
        </Cell>
        <Cell state="wynik" note="Ten sam błąd był już zgłoszony — komentarz nie został dodany.">
          <EscalationCell result={ESCALATION_DUPLICATE} />
        </Cell>
      </Group>

      <Group title="Wynik wyszukiwania">
        <Cell
          state="hover / focus-visible / disabled"
          note="N/A — wyniki są statyczne; jedyna kontrolka to przycisk przekazania (sekcja wyżej)."
        />
        <Cell state="loading" note="Region role=status z kartą zastępczą o stałej minimalnej wysokości.">
          <OutcomeRegion result={null} pending />
        </Cell>
        <Cell state="default" note="Znalezione rozwiązania (zgłoszenie i dokumentacja ERP).">
          <OutcomeRegion result={MATCHED} pending={false} escalation={<EscalationCell open={false} />} />
        </Cell>
        <Cell state="empty" note="Dopasowanie bez wpisów: komunikat zamiast pustej listy.">
          <OutcomeRegion result={MATCHED_EMPTY} pending={false} escalation={<EscalationCell open={false} />} />
        </Cell>
        <Cell state="default" note="Brak rozwiązania — utworzono zgłoszenie.">
          <OutcomeRegion result={TICKET_CREATED} pending={false} />
        </Cell>
        <Cell state="error" note="Wyszukiwanie niedostępne — zgłoszenie trafiło od razu do serwisu.">
          <OutcomeRegion result={TICKET_CREATED_NO_SEARCH} pending={false} />
        </Cell>
        <Cell state="default" note="Ten błąd jest już zgłoszony (otwarte zgłoszenie).">
          <OutcomeRegion result={ALREADY_REPORTED} pending={false} />
        </Cell>
      </Group>

      <Group title="Twoje zgłoszenia">
        <Cell
          state="hover / focus-visible / disabled"
          note="N/A — lista nie ma kontrolek; pełna treść ucięta wiersza jest w atrybucie title."
        />
        <Cell state="loading" note="aria-busy i wiersze zastępcze, żeby lista nie przesuwała treści.">
          <MyTicketsList state={{ status: "loading" }} />
        </Cell>
        <Cell state="default" note="Zgłoszenie oczekujące i rozwiązane (z przyczyną i krokami).">
          <MyTicketsList state={{ status: "ok", tickets: [TODO_TICKET, RESOLVED_TICKET] }} />
        </Cell>
        <Cell state="empty">
          <MyTicketsList state={{ status: "ok", tickets: [] }} />
        </Cell>
        <Cell state="error">
          <MyTicketsList state={{ status: "error", error: "Nie udało się wczytać Twoich zgłoszeń." }} />
        </Cell>
      </Group>
    </div>
  );
}
