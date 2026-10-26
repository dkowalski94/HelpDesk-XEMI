import type React from "react";
import { Loader2, Send, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { COMMENT_MAX_LENGTH } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import type { EscalationSuccess } from "@/types";
import { ErrorAlert } from "./ErrorAlert";
import { FieldCounter } from "./FieldCounter";
import { FIXED_ROWS, FOCUS_RING, INNER_CARD, formatDate } from "./format";

export interface EscalationResult {
  escalation: EscalationSuccess;
  withComment: boolean;
}

interface EscalationControlProps {
  open: boolean;
  comment: string;
  /** Trimmed comment length, as counted against the limit. */
  length: number;
  pending: boolean;
  blocked: boolean;
  error: string | null;
  result: EscalationResult | null;
  onOpen: () => void;
  onCommentChange: (value: string) => void;
  onSubmit: (e: React.SubmitEvent<HTMLFormElement>) => void;
}

/** "Żadna z sugestii nie pomogła" (S-03): trigger, comment form, or the escalation result. */
export function EscalationControl({
  open,
  comment,
  length,
  pending,
  blocked,
  error,
  result,
  onOpen,
  onCommentChange,
  onSubmit,
}: EscalationControlProps) {
  // After success the control is gone, so the same match cannot be escalated twice.
  if (result) {
    if (result.escalation.outcome === "ticket-created") {
      return (
        <Card role="status" className={INNER_CARD}>
          <p className="text-foreground/80 text-sm">
            {result.withComment
              ? "Przekazaliśmy błąd do zespołu serwisowego XEMI razem z Twoim komentarzem."
              : "Przekazaliśmy błąd do zespołu serwisowego XEMI."}
          </p>
        </Card>
      );
    }

    return (
      <Card role="status" className={INNER_CARD}>
        <p className="text-warning text-sm font-semibold">Ten błąd został już zgłoszony</p>
        <p className="text-foreground/80 mt-1 text-sm">
          Zgłoszenie z {formatDate(result.escalation.ticket.createdAt)} czeka na zespół serwisowy.
        </p>
        {result.withComment && (
          <p className="text-muted-foreground mt-1 text-sm">Nowy komentarz nie został dodany do tego zgłoszenia.</p>
        )}
      </Card>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={onOpen} className={FOCUS_RING}>
        <ThumbsDown />
        Żadna z sugestii nie pomogła
      </Button>
    );
  }

  return (
    <Card className={INNER_CARD}>
      <form onSubmit={onSubmit} className="space-y-2">
        <label htmlFor="escalationComment" className="text-foreground block text-sm font-semibold">
          Komentarz (opcjonalnie)
        </label>
        <p id="escalationComment-hint" className="text-muted-foreground text-sm">
          Opisz, co zostało już wypróbowane — pomoże to zespołowi serwisowemu.
        </p>
        <Textarea
          id="escalationComment"
          name="comment"
          rows={4}
          value={comment}
          aria-describedby="escalationComment-hint escalationComment-counter"
          onChange={(e) => {
            onCommentChange(e.target.value);
          }}
          className={cn(FIXED_ROWS, "bg-card", FOCUS_RING)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FieldCounter
            id="escalationComment-counter"
            length={length}
            max={COMMENT_MAX_LENGTH}
            tooLongMessage="komentarz jest za długi"
          />
          <Button type="submit" variant="outline" disabled={blocked} className={FOCUS_RING}>
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
            {pending ? "Przekazuję..." : "Przekaż do serwisu"}
          </Button>
        </div>
        {error && <ErrorAlert message={error} />}
      </form>
    </Card>
  );
}
