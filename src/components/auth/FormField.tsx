import type { ReactNode } from "react";
import { useId } from "react";
import { CircleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Full-strength focus ring: `--ring` at half alpha is below 3:1 on white (CLAUDE.md → UI contract).
const FOCUS_RING = "focus-visible:border-ring focus-visible:ring-ring";

interface FormFieldProps {
  /** Form field name; the element id is generated, so several forms can share a page (kitchen sink). */
  name: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  /** Shown under the field when there is no error. */
  hint?: string;
  icon: ReactNode;
  endContent?: ReactNode;
}

/** `Label` + `Input` with a leading icon; the error or hint is tied to the input via `aria-describedby`. */
export function FormField({
  name,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  error,
  hint,
  icon,
  endContent,
}: FormFieldProps) {
  const id = useId();
  const inputId = `${id}-${name}`;
  const messageId = `${id}-${name}-message`;
  const message = error ?? hint;

  return (
    <div className="space-y-1">
      <Label htmlFor={inputId} className="text-foreground">
        {label}
      </Label>
      <div className="relative">
        <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2">
          {icon}
        </span>
        <Input
          id={inputId}
          name={name}
          type={type}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn("bg-card pl-10", endContent ? "pr-10" : undefined, FOCUS_RING)}
        />
        {endContent}
      </div>
      {error ? (
        <p id={messageId} className="text-destructive flex items-center gap-1 text-xs">
          <CircleAlert className="size-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
