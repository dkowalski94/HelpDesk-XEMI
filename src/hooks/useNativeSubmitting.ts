import { useEffect, useState } from "react";

/**
 * Pending state for a form that posts natively (`method="POST" action="/api/…"`). React's
 * `useFormStatus()` only tracks function actions, so it never reports a native post as
 * pending. Call `markSubmitting()` once validation passes; the flag resets when the browser
 * restores the page from the back/forward cache, so the button is not left disabled.
 */
export function useNativeSubmitting(): [submitting: boolean, markSubmitting: () => void] {
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setSubmitting(false);
    };
    window.addEventListener("pageshow", reset);
    return () => {
      window.removeEventListener("pageshow", reset);
    };
  }, []);

  return [
    submitting,
    () => {
      setSubmitting(true);
    },
  ];
}
