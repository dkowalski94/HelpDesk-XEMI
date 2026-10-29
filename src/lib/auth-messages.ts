// Dependency-free: the auth endpoints map Supabase errors to a short code for the URL,
// and the auth pages map that code to a fixed Polish sentence. The raw `?error=` value
// is never rendered.

/** The subset of Supabase's `AuthError` the mapping reads; typed loosely to stay import-free. */
export interface AuthErrorLike {
  code?: string;
  status?: number;
}

const RATE_LIMIT_CODES = new Set(["over_request_rate_limit", "over_email_send_rate_limit"]);

export function signinErrorCode(error: AuthErrorLike | null | undefined): string {
  const code = error?.code;
  if (code === "invalid_credentials") return "invalid-credentials";
  if (code === "email_not_confirmed") return "email-not-confirmed";
  if (code !== undefined && RATE_LIMIT_CODES.has(code)) return "rate-limited";
  return "unknown";
}

export function signupErrorCode(error: AuthErrorLike | null | undefined): string {
  const code = error?.code;
  if (code === "user_already_exists" || code === "email_exists") return "already-registered";
  if (code === "weak_password") return "weak-password";
  if (code === "email_address_invalid" || code === "validation_failed") return "invalid-email";
  if (code === "signup_disabled") return "signup-disabled";
  if (code !== undefined && RATE_LIMIT_CODES.has(code)) return "rate-limited";
  return "unknown";
}

const MESSAGES: Record<string, string> = {
  "invalid-credentials": "Nieprawidłowy e-mail lub hasło.",
  "email-not-confirmed": "Adres e-mail nie został jeszcze potwierdzony. Kliknij link z wiadomości aktywacyjnej.",
  "rate-limited": "Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.",
  "already-registered": "Konto z tym adresem e-mail już istnieje. Zaloguj się.",
  "weak-password": "Hasło jest za słabe. Użyj co najmniej 6 znaków.",
  "invalid-email": "Podaj poprawny adres e-mail.",
  "signup-disabled": "Zakładanie kont jest obecnie wyłączone.",
  "not-configured": "Logowanie jest chwilowo niedostępne (brak konfiguracji Supabase).",
  "missing-fields": "Podaj e-mail i hasło.",
};

const GENERIC_MESSAGE = "Nie udało się. Spróbuj ponownie za chwilę.";

/**
 * `null` when there is no code; a fixed Polish sentence for a known code; the generic
 * sentence for anything else (including `unknown` and hand-edited values).
 */
export function authErrorMessage(code: string | null | undefined): string | null {
  if (code === null || code === undefined || code === "") return null;
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : GENERIC_MESSAGE;
}
