import { Eye, EyeOff } from "lucide-react";

// Full-strength focus outline, as the quiet links of the user bar (CLAUDE.md → UI contract).
const toggleClass =
  "absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

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
