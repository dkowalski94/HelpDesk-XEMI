---
change_id: start-page
title: Start page
status: implemented
created: 2026-10-28
updated: 2026-10-28
archived_at: null
---

## Notes

- 2026-10-28, faza 1 (po weryfikacji ręcznej, decyzja użytkownika): pasek użytkownika przebudowany już tutaj, nie w S-04 — wejścia roli jako przyciski (klient: Zgłoś błąd, Moje zgłoszenia; serwis: Zgłoszenia do rozwiązania, Użytkownicy), „Zalogowany jako:”, „Wyloguj”; bez linków Dashboard i Web search. Prezentacyjny `UserBar.astro` + `Topbar.astro` czytający locals. S-04 zostaje głównie z powrotem na żądaną stronę po zalogowaniu.
- Strona startowa wypełnia wysokość okna; kafelki „Jak to działa” większe, z piktogramami lucide (ClipboardPaste, Lightbulb, Wrench), pokazywane dla każdej grupy odbiorców. Faza 2: punkt „Topbar Dashboard → Strona startowa” jest już nieaktualny (link zniknął w fazie 1).
- Strona startowa nie pokazuje nazwy firmy (decyzja użytkownika); `/report-error` i `/my-tickets` mają szerokość strony startowej (`max-w-5xl`). Faza 2, smoke: kroki „Client user at Klient Alfa” przenieść na `/` ze sprawdzeniem wejść klienta na pasku (`href="/report-error"`, `href="/my-tickets"`), nie tekstu „Klient Alfa”.
