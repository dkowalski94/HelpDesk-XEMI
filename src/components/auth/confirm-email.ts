/** Texts of `/auth/confirm-email`, shared by the page's `<title>` and `ConfirmEmailNotice`. */
export function confirmEmailContent(autoConfirmed: boolean) {
  return autoConfirmed
    ? { heading: "Konto założone", description: "Możesz się teraz zalogować." }
    : {
        heading: "Sprawdź skrzynkę e-mail",
        description: "Wysłaliśmy link aktywacyjny na Twój adres e-mail. Kliknij go, aby aktywować konto.",
      };
}
