import React, { useState } from "react";
import { Mail, Lock, LogIn } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

interface FieldErrors {
  email?: string;
  password?: string;
}

interface Props {
  serverError?: string | null;
  /** Already validated by the page with safeNextPath(); posted back only when it is not "/". */
  next?: string;
  // Initial state for the kitchen sink's static cells; the pages pass none of these.
  initialEmail?: string;
  initialPassword?: string;
  initialErrors?: FieldErrors;
  initialShowPassword?: boolean;
  pending?: boolean;
}

export default function SignInForm({
  serverError,
  next: nextPath = "/",
  initialEmail = "",
  initialPassword = "",
  initialErrors = {},
  initialShowPassword = false,
  pending,
}: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState(initialPassword);
  const [showPassword, setShowPassword] = useState(initialShowPassword);
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

  return (
    <form method="POST" action="/api/auth/signin" className="space-y-4" onSubmit={handleSubmit} noValidate>
      {nextPath !== "/" && <input type="hidden" name="next" value={nextPath} />}
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
        placeholder="Twoje hasło"
        autoComplete="current-password"
        error={errors.password}
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

      <ServerError message={serverError} />

      <SubmitButton pendingText="Logowanie…" icon={<LogIn className="size-4" />} pending={pending}>
        Zaloguj się
      </SubmitButton>
    </form>
  );
}
