import { Alert, AlertDescription } from "@/components/ui/alert";

/** A request failure message (`role="alert"` from `Alert`). */
export function ErrorAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
