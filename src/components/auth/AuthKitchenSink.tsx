import type React from "react";
import { authErrorMessage } from "@/lib/auth-messages";
import SignInForm from "./SignInForm";
import SignUpForm from "./SignUpForm";

/*
 * Dev-only gallery (`/dev/ui-kitchen-sink`): the sign-in and sign-up forms with static initial
 * state, one cell per state, with `preventSubmit` so no cell posts. Each FormField generates its own ids,
 * so the forms can share the page.
 * The confirm-email card is an Astro component and is rendered by the kitchen-sink page itself.
 */

const EMAIL = "jan.kowalski@firma.pl";
const PASSWORD = "tajne-haslo";

function Cell({ state, note, children }: { state: string; note?: string; children?: React.ReactNode }) {
  return (
    <div className="border-border space-y-3 rounded-lg border border-dashed p-4">
      <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{state}</p>
      {note && <p className="text-muted-foreground text-sm">{note}</p>}
      <div className="bg-card border-border mx-auto w-full max-w-md rounded-xl border p-6">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">{title}</h2>
      <div className="grid gap-4 lg:grid-cols-2">{children}</div>
    </section>
  );
}

export default function AuthKitchenSink() {
  return (
    <div className="space-y-10">
      <Group title="Logowanie">
        <Cell state="default" note="Puste pola. Tab: e-mail → hasło → przełącznik → przycisk.">
          <SignInForm preventSubmit />
        </Cell>
        <Cell state="error" note="Wysłanie pustego formularza: błędy pól z aria-invalid i aria-describedby.">
          <SignInForm preventSubmit initialErrors={{ email: "Podaj adres e-mail", password: "Podaj hasło" }} />
        </Cell>
        <Cell state="error" note="Błąd z serwera (?error=invalid-credentials).">
          <SignInForm
            preventSubmit
            initialEmail={EMAIL}
            initialPassword={PASSWORD}
            serverError={authErrorMessage("invalid-credentials")}
          />
        </Cell>
        <Cell state="loading / disabled" note="Wysyłanie: przycisk zablokowany ze spinnerem.">
          <SignInForm preventSubmit initialEmail={EMAIL} initialPassword={PASSWORD} pending />
        </Cell>
        <Cell state="hasło ukryte" note="Przełącznik „Pokaż hasło”, aria-pressed=false.">
          <SignInForm preventSubmit initialEmail={EMAIL} initialPassword={PASSWORD} />
        </Cell>
        <Cell state="hasło widoczne" note="Przełącznik „Pokaż hasło”, aria-pressed=true.">
          <SignInForm preventSubmit initialEmail={EMAIL} initialPassword={PASSWORD} initialShowPassword />
        </Cell>
      </Group>

      <Group title="Zakładanie konta">
        <Cell state="default" note="Puste pola.">
          <SignUpForm preventSubmit />
        </Cell>
        <Cell state="podpowiedź" note="Za krótkie hasło: podpowiedź z liczbą brakujących znaków.">
          <SignUpForm preventSubmit initialEmail={EMAIL} initialPassword="abcd" />
        </Cell>
        <Cell state="error" note="Hasła się różnią.">
          <SignUpForm
            preventSubmit
            initialEmail={EMAIL}
            initialPassword={PASSWORD}
            initialConfirmPassword="inne-haslo"
            initialErrors={{ confirmPassword: "Hasła się różnią" }}
          />
        </Cell>
        <Cell state="error" note="Błąd z serwera (?error=already-registered).">
          <SignUpForm
            preventSubmit
            initialEmail={EMAIL}
            initialPassword={PASSWORD}
            initialConfirmPassword={PASSWORD}
            serverError={authErrorMessage("already-registered")}
          />
        </Cell>
        <Cell state="loading / disabled" note="Wysyłanie: przycisk zablokowany ze spinnerem.">
          <SignUpForm
            preventSubmit
            initialEmail={EMAIL}
            initialPassword={PASSWORD}
            initialConfirmPassword={PASSWORD}
            pending
          />
        </Cell>
      </Group>
    </div>
  );
}
