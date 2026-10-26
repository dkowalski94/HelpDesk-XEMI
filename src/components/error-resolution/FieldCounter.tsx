import { cn } from "@/lib/utils";

interface FieldCounterProps {
  id: string;
  length: number;
  max: number;
  /** Appended after the count when `length` exceeds `max`. */
  tooLongMessage: string;
}

/** "n / max" under a text field; turns destructive with a message once the trimmed text is over the limit. */
export function FieldCounter({ id, length, max, tooLongMessage }: FieldCounterProps) {
  const tooLong = length > max;

  return (
    <p
      id={id}
      aria-live="polite"
      className={cn("text-xs", tooLong ? "text-destructive font-semibold" : "text-muted-foreground")}
    >
      {length} / {max}
      {tooLong && ` — ${tooLongMessage}`}
    </p>
  );
}
