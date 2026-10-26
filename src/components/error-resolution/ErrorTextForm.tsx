import type React from "react";
import { useId } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ERROR_TEXT_MAX_LENGTH } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import { ErrorAlert } from "./ErrorAlert";
import { FieldCounter } from "./FieldCounter";
import { FIXED_ROWS, FOCUS_RING } from "./format";

interface ErrorTextFormProps {
  value: string;
  /** Trimmed length, as counted against the limit. */
  length: number;
  pending: boolean;
  blocked: boolean;
  /** The last submit failure, shown under the form it belongs to. */
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: (e: React.SubmitEvent<HTMLFormElement>) => void;
}

/** The paste field and its submit button. State and the request live in `ErrorResolutionPanel`. */
export function ErrorTextForm({ value, length, pending, blocked, error, onChange, onSubmit }: ErrorTextFormProps) {
  // Generated ids: the kitchen sink renders several forms on one page.
  const id = useId();
  const fieldId = `${id}-errorText`;
  const hintId = `${id}-hint`;
  const counterId = `${id}-counter`;
  const emptyId = `${id}-empty`;

  const empty = length === 0;
  const tooLong = length > ERROR_TEXT_MAX_LENGTH;
  // Why the submit is disabled, announced with the button (pending explains itself in the label).
  const blockedReasonId = pending ? undefined : empty ? emptyId : tooLong ? counterId : undefined;

  return (
    <form onSubmit={onSubmit} aria-busy={pending} className="space-y-2">
      <label htmlFor={fieldId} className="text-foreground block text-sm font-semibold">
        Treść komunikatu błędu
      </label>
      <p id={hintId} className="text-muted-foreground text-sm">
        Skopiuj z okna błędu ERP tylko treść komunikatu błędu — bez całego logu ani zrzutu ekranu.
      </p>
      <Textarea
        id={fieldId}
        name="errorText"
        rows={6}
        value={value}
        aria-invalid={tooLong}
        aria-describedby={`${hintId} ${counterId}`}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className={cn(FIXED_ROWS, FOCUS_RING)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <FieldCounter
            id={counterId}
            length={length}
            max={ERROR_TEXT_MAX_LENGTH}
            tooLongMessage="tekst jest za długi"
          />
          {empty && !pending && (
            <p id={emptyId} className="text-muted-foreground text-xs">
              Wklej treść błędu, aby wysłać
            </p>
          )}
        </div>
        <Button type="submit" disabled={blocked} aria-describedby={blockedReasonId} className={FOCUS_RING}>
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          {pending ? "Szukam rozwiązania..." : "Wyślij"}
        </Button>
      </div>
      {error && <ErrorAlert message={error} />}
    </form>
  );
}
