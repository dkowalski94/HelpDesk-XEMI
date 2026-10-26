import type React from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ERROR_TEXT_MAX_LENGTH } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import { FieldCounter } from "./FieldCounter";
import { FIXED_ROWS, FOCUS_RING } from "./format";

interface ErrorTextFormProps {
  value: string;
  /** Trimmed length, as counted against the limit. */
  length: number;
  pending: boolean;
  blocked: boolean;
  onChange: (value: string) => void;
  onSubmit: (e: React.SubmitEvent<HTMLFormElement>) => void;
}

/** The paste field and its submit button. State and the request live in `ErrorResolutionPanel`. */
export function ErrorTextForm({ value, length, pending, blocked, onChange, onSubmit }: ErrorTextFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <label htmlFor="errorText" className="text-foreground block text-sm font-semibold">
        Treść komunikatu błędu
      </label>
      <p id="errorText-hint" className="text-muted-foreground text-sm">
        Skopiuj z okna błędu ERP tylko treść komunikatu błędu — bez całego logu ani zrzutu ekranu.
      </p>
      <Textarea
        id="errorText"
        name="errorText"
        rows={6}
        value={value}
        aria-describedby="errorText-hint errorText-counter"
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className={cn(FIXED_ROWS, FOCUS_RING)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldCounter
          id="errorText-counter"
          length={length}
          max={ERROR_TEXT_MAX_LENGTH}
          tooLongMessage="tekst jest za długi"
        />
        <Button type="submit" disabled={blocked} className={FOCUS_RING}>
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          {pending ? "Szukam rozwiązania..." : "Wyślij"}
        </Button>
      </div>
    </form>
  );
}
