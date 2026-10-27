import { cn } from "@/lib/utils";

interface FieldCounterProps {
  id: string;
  length: number;
  max: number;
  /** Appended after the count when `length` exceeds `max`. */
  tooLongMessage: string;
}

/**
 * "n / max" under a text field; turns destructive with a message once the trimmed text is over the limit.
 * Only crossing the limit is announced (a separate live line) — the count itself is read with the field
 * through `aria-describedby`, not on every keystroke.
 */
export function FieldCounter({ id, length, max, tooLongMessage }: FieldCounterProps) {
  const tooLong = length > max;

  return (
    <>
      <p id={id} className={cn("text-xs", tooLong ? "text-destructive font-semibold" : "text-muted-foreground")}>
        {length} / {max}
        {tooLong && ` — ${tooLongMessage}`}
      </p>
      <span role="status" className="sr-only">
        {tooLong ? tooLongMessage : ""}
      </span>
    </>
  );
}
