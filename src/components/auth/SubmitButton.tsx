import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SubmitButtonProps {
  pendingText: string;
  icon: ReactNode;
  children: ReactNode;
  /** Set by the form (`useNativeSubmitting()`); the kitchen sink passes it as a static prop. */
  pending: boolean;
}

export function SubmitButton({ pendingText, icon, children, pending: isPending }: SubmitButtonProps) {
  return (
    <Button type="submit" disabled={isPending} className="w-full">
      {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : icon}
      {isPending ? pendingText : children}
    </Button>
  );
}
