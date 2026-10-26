import React, { useState } from "react";
import { COMMENT_MAX_LENGTH, ERROR_TEXT_MAX_LENGTH } from "@/lib/error-text";
import { useMyTickets } from "@/hooks/useMyTickets";
import type { ErrorResolutionResponse, ErrorResolutionSuccess, EscalationResponse } from "@/types";
import { ErrorAlert } from "./ErrorAlert";
import { ErrorTextForm } from "./ErrorTextForm";
import { EscalationControl, type EscalationResult } from "./EscalationControl";
import { MyTicketsList } from "./MyTicketsList";
import { ResolutionOutcome } from "./ResolutionOutcome";

/**
 * "None of the suggestions helped" under a match (S-03): files a ticket for the text that
 * produced the match, with an optional comment. State lives here, so a new paste — which
 * unmounts the matched view — starts it afresh. Presentation is `EscalationControl`.
 */
function Escalation({ errorText, onEscalated }: { errorText: string; onEscalated: () => void }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EscalationResult | null>(null);

  const length = comment.trim().length;
  const tooLong = length > COMMENT_MAX_LENGTH;
  const blocked = pending || tooLong;

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked) return;

    setPending(true);
    setError(null);

    const body = new FormData();
    body.set("errorText", errorText);
    body.set("comment", comment);

    try {
      const response = await fetch("/api/escalate-error", { method: "POST", body });
      // A non-JSON body (e.g. an HTML 502 page) means the server was reached but failed.
      const payload = (await response.json().catch(() => null)) as EscalationResponse | null;
      if (!payload) {
        setError("Wystąpił błąd serwera. Spróbuj ponownie za chwilę.");
      } else if (payload.ok) {
        setResult({ escalation: payload, withComment: length > 0 });
        onEscalated();
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
    <EscalationControl
      open={open}
      comment={comment}
      length={length}
      pending={pending}
      blocked={blocked}
      error={error}
      result={result}
      onOpen={() => {
        setOpen(true);
      }}
      onCommentChange={setComment}
      onSubmit={handleSubmit}
    />
  );
}

export default function ErrorResolutionPanel() {
  const [errorText, setErrorText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ErrorResolutionSuccess | null>(null);
  // The text that produced `result`, kept apart from the textarea so editing it after a
  // match does not change what an escalation sends.
  const [submittedText, setSubmittedText] = useState("");
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
    const sentText = errorText;
    const body = new FormData();
    body.set("errorText", sentText);

    try {
      const response = await fetch("/api/resolve-error", { method: "POST", body });
      // A non-JSON body (e.g. an HTML 502 page) means the server was reached but failed.
      const payload = (await response.json().catch(() => null)) as ErrorResolutionResponse | null;
      if (!payload) {
        setError("Wystąpił błąd serwera. Spróbuj ponownie za chwilę.");
      } else if (payload.ok) {
        setSubmittedText(sentText);
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
      <ErrorTextForm
        value={errorText}
        length={length}
        pending={pending}
        blocked={blocked}
        onChange={setErrorText}
        onSubmit={handleSubmit}
      />

      {error && <ErrorAlert message={error} />}

      {result && (
        <ResolutionOutcome result={result} escalation={<Escalation errorText={submittedText} onEscalated={reload} />} />
      )}

      <MyTicketsList state={myTickets} />
    </div>
  );
}
