import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ServerErrorProps {
  message?: string | null;
}

/** The sign-in / sign-up failure sentence from `?error=` (`role="alert"` from `Alert`). */
export function ServerError({ message }: ServerErrorProps) {
  if (!message) return null;

  return (
    <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
      <CircleAlert aria-hidden="true" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
