import { Eye, EyeOff } from "lucide-react";
import { LINK_CLASS } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

// The shared quiet-link focus outline and hover colour, in the muted icon colour.
const toggleClass = cn(LINK_CLASS, "absolute top-1/2 right-2 -translate-y-1/2 p-1 text-muted-foreground");

interface PasswordToggleProps {
  visible: boolean;
  onToggle: () => void;
}

export function PasswordToggle({ visible, onToggle }: PasswordToggleProps) {
  return (
    <button type="button" onClick={onToggle} className={toggleClass} aria-label="Pokaż hasło" aria-pressed={visible}>
      {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
    </button>
  );
}
