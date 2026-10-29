import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Full-strength focus ring: `--ring` at half alpha is below 3:1 on white (CLAUDE.md → UI contract).
const FOCUS_RING = "focus-visible:border-ring focus-visible:ring-ring";

interface SubmitButtonProps {
  pendingText: string;
  icon: ReactNode;
  children: ReactNode;
  /** Set by the form (`useNativeSubmitting()`); the kitchen sink passes it as a static prop. */
  pending: boolean;
}

export function SubmitButton({ pendingText, icon, children, pending: isPending }: SubmitButtonProps) {
  return (
    <Button type="submit" disabled={isPending} className={cn("w-full", FOCUS_RING)}>
      {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : icon}
      {isPending ? pendingText : children}
    </Button>
  );
}
