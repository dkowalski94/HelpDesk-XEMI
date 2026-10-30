/** Polish date and time, in Polish time on both the UTC Worker and the browser. */
export function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" });
}
