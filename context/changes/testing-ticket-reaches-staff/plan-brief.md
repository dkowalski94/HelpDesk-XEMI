# Zgłoszenie klienta zawsze trafia do kolejki serwisu — Plan Brief

> Full plan: `context/changes/testing-ticket-reaches-staff/plan.md`
> Research: `context/changes/testing-ticket-reaches-staff/research.md`

## What & Why

Test-plan Phase 1, ryzyko #1: klient widzi zgłoszenie jako przyjęte, a serwis nie ma go w kolejce — przy braku dopasowania, niedostępnym wyszukiwaniu i eskalacji. Dziś nie ma błędu w kodzie, ale nie ma też siatki: smoke sprawdza kolejkę tylko na pierwszej stronie (i z czasem przestaje widzieć nowe zgłoszenia), a ścieżka „błąd zapisu → błąd dla klienta” nie ma żadnego testu. Faza wprowadza też runner jednostkowy do projektu.

## Starting Point

Wszystkie trzy ścieżki zbiegają się w jednej funkcji zapisu, a kolejka serwisu to jedno zapytanie (oldest-first, 50 na stronę). Brak runnera testów; jedyne siatki to `scripts/smoke.mjs` i `supabase/tests/rls.sql` w jobie CI `smoke`.

## Desired End State

`npm test` (Vitest) na lokalnym Supabase udowadnia, że każde zgłoszenie zwrócone klientowi jest w kolejce serwisu jako `todo`, a błąd zapisu daje `ok:false` bez wiersza. Smoke szuka zgłoszeń w `/admin/tickets` po id przez wszystkie strony. Oba działają w CI jako wymagane bramki, a cookbook test-planu mówi, jak dodać kolejny taki test.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Runner | Vitest 5.x | Vite-native, zgodny z Vite 8 / Node 22, zalecany przez Astro. | Research |
| Warstwa „unit” | Vitest wywołuje serwis z prawdziwą sesją persony na lokalnym Supabase | Reguła duplikatu i zapis to zapytania do bazy; mock bazy jest zakazanym anty-wzorcem. | Research |
| Błąd zapisu | Prawdziwa odmowa RLS (`caller.companyId` obcej firmy) | Przez HTTP nieosiągalny; to jedyny sygnał bez mocka. | Research |
| Konfiguracja Vitest | Spike `getViteConfig()`, fallback alias `@/` (+ ewentualny alias `astro:env/server`) | Zgodność z Astro z deterministycznym planem B. | Plan |
| Kolejka w smoke | Filtr firmy + przechodzenie stron, po id | Odporne na kumulację danych, sprawdza filtr i stronicowanie serwisu. | Plan |
| Miejsce w CI | Krok `npm test` w jobie `smoke` (po `rls.sql`, przed buildem) | Supabase już tam działa; minimalna zmiana YAML. | Plan |
| Dane testów | Unikalny tekst na przebieg, asercje po id, bez sprzątania | Bez `service_role` i bez nowych grantów. | Plan |
| „Brak dopasowania” w CI | Stub tylko `embedText` stałym wektorem; RPC i zapis prawdziwe | Pokrywa gałąź bez klucza OpenAI i bez mocka bazy. | Plan |
| Wpływ na budżet smoke | Akceptujemy i dokumentujemy (~4 zgłoszenia Alfa/przebieg) | CI ma świeżą bazę; lokalnie częstszy `db reset`. | Plan |
| Brak Supabase / zdalny URL | Test rzuca błąd, nie pomija się | Pominięta bramka to cichy sukces; zdalna baza to ryzyko zapisu. | Plan |

## Scope

**In scope:**
- `vitest`, `vitest.config.ts`, `npm test`, helper `src/test/supabase-personas.ts`
- `src/lib/services/error-resolution.test.ts` — 7 przypadków (3 ścieżki tworzenia, duplikat, eskalacja, 2× błąd zapisu)
- Smoke: helper stronicowania kolejki, kroki kolejki po id, nagłówek
- Krok CI, CLAUDE.md, test-plan §4/§5/§6

**Out of scope:**
- Zmiany kodu produkcyjnego, migracji, seeda
- Klucz OpenAI w CI, ścieżka `matched` (ryzyko #5)
- Testy wyglądu wyspy, sprzątanie danych, osobny job CI, wyścigi współbieżności

## Architecture / Approach

Test → `resolveError`/`escalateUnhelpful` (sesja `alfa`, mock tylko `@/lib/openai`) → prawdziwy PostgREST/RLS → `listTodoQueue` w sesji `staff` z filtrem Alfa, po `nextOffset` aż do id. Smoke robi to samo przez HTML `/admin/tickets?company=…&offset=…`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Runner Vitest i testy serwisu | `npm test` z 7 przypadkami ryzyka #1 | `getViteConfig` + adapter Cloudflare pod Vitest (jest fallback) |
| 2. Smoke — kolejka po id | Kroki kolejki niezależne od liczby stron | Parsowanie linku następnej strony z HTML |
| 3. CI i cookbook | Wymagane bramki w CI, §6.1/§6.2 | Kolejność kroków (`rls.sql` przed `npm test`) |

**Prerequisites:** Docker + `npx supabase start`, `.env` z lokalnym `SUPABASE_URL`/`SUPABASE_KEY`, `npx supabase db reset` przed testami.
**Estimated effort:** ~2–3 sesje w 3 fazach.

## Open Risks & Assumptions

- Zakładamy, że `vi.mock("@/lib/openai")` wystarcza, by testy nie potrzebowały `astro:env`; jeśli nie — alias modułu testowego.
- Wektor `e1` nie przekroczy progu 0,5 z lokalnie wgranymi embeddingami (realne komponenty są małe); gdyby przekroczył, test pada czytelnie jako `matched`.
- Lokalny budżet przebiegów smoke bez resetu spada z ~24 do ~8 par `npm test` + smoke.

## Success Criteria (Summary)

- Zepsucie zapisu zgłoszenia lub kolejki serwisu wywala `npm test` i/lub smoke w CI.
- Kroki kolejki smoke przechodzą niezależnie od liczby zgłoszeń w bazie.
- Nowy test tego rodzaju da się dodać z samego cookbooka test-planu.
