import React, { useState } from "react";
import { Mail, Lock, UserPlus } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

const MIN_PASSWORD_LENGTH = 6;

/** "Jeszcze 1 znak" / "Jeszcze 2 znaki" / "Jeszcze 5 znaków" (Polish plural; 12–14 take "znaków"). */
function remainingCharactersHint(count: number): string {
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  const noun =
    count === 1 ? "znak" : lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14) ? "znaki" : "znaków";
  return `Jeszcze ${String(count)} ${noun}`;
}

interface FieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

interface Props {
  serverError?: string | null;
  // Initial state for the kitchen sink's static cells; the page passes none of these.
  initialEmail?: string;
  initialPassword?: string;
  initialConfirmPassword?: string;
  initialErrors?: FieldErrors;
  initialShowPassword?: boolean;
  pending?: boolean;
}

export default function SignUpForm({
  serverError,
  initialEmail = "",
  initialPassword = "",
  initialConfirmPassword = "",
  initialErrors = {},
  initialShowPassword = false,
  pending,
}: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState(initialPassword);
  const [confirmPassword, setConfirmPassword] = useState(initialConfirmPassword);
  const [showPassword, setShowPassword] = useState(initialShowPassword);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>(initialErrors);

  function validate() {
    const next: FieldErrors = {};

    if (!email.trim()) {
      next.email = "Podaj adres e-mail";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = "Podaj poprawny adres e-mail";
    }

    if (!password) {
      next.password = "Podaj hasło";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Hasło musi mieć co najmniej ${String(MIN_PASSWORD_LENGTH)} znaków`;
    }

    if (!confirmPassword) {
      next.confirmPassword = "Powtórz hasło";
    } else if (password !== confirmPassword) {
      next.confirmPassword = "Hasła się różnią";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof FieldErrors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  const passwordHint =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH
      ? remainingCharactersHint(MIN_PASSWORD_LENGTH - password.length)
      : undefined;

  return (
    <form method="POST" action="/api/auth/signup" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        name="email"
        type="email"
        label="E-mail"
        value={email}
        onChange={(v) => {
          setEmail(v);
          clearError("email");
        }}
        placeholder="jan.kowalski@firma.pl"
        autoComplete="email"
        error={errors.email}
        icon={<Mail className="size-4" />}
      />

      <FormField
        name="password"
        label="Hasło"
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(v) => {
          setPassword(v);
          clearError("password");
        }}
        placeholder="Co najmniej 6 znaków"
        autoComplete="new-password"
        error={errors.password}
        hint={passwordHint}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showPassword}
            onToggle={() => {
              setShowPassword(!showPassword);
            }}
          />
        }
      />

      <FormField
        name="confirmPassword"
        label="Powtórz hasło"
        type={showConfirmPassword ? "text" : "password"}
        value={confirmPassword}
        onChange={(v) => {
          setConfirmPassword(v);
          clearError("confirmPassword");
        }}
        placeholder="Wpisz hasło ponownie"
        autoComplete="new-password"
        error={errors.confirmPassword}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showConfirmPassword}
            onToggle={() => {
              setShowConfirmPassword(!showConfirmPassword);
            }}
          />
        }
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Zakładanie konta…" icon={<UserPlus className="size-4" />} pending={pending}>
        Załóż konto
      </SubmitButton>
    </form>
  );
}
