import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Full-strength focus ring: `--ring` at half alpha is below 3:1 on white (CLAUDE.md → UI contract).
const FOCUS_RING = "focus-visible:border-ring focus-visible:ring-ring";

interface SubmitButtonProps {
  pendingText: string;
  icon: ReactNode;
  children: ReactNode;
  /** Overrides `useFormStatus()` — the kitchen sink renders the pending state with static props. */
  pending?: boolean;
}

export function SubmitButton({ pendingText, icon, children, pending }: SubmitButtonProps) {
  const status = useFormStatus();
  const isPending = pending ?? status.pending;

  return (
    <Button type="submit" disabled={isPending} className={cn("w-full", FOCUS_RING)}>
      {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : icon}
      {isPending ? pendingText : children}
    </Button>
  );
}
