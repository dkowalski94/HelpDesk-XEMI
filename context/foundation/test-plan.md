# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-11-24

## 1. Strategy

Testy w tym projekcie podlegają trzem nienegocjowalnym zasadom:

1. **Koszt × sygnał.** Wygrywa najtańszy test, który daje rzeczywisty sygnał
   dla ryzyka. Nie promuj testu do e2e tylko dlatego, że e2e „wydaje się
   bezpieczniejsze”. Nie nakładaj modelu wizji na deterministyczny diff,
   który już wykrywa regresję.
2. **Obawy użytkownika są pełnoprawnym dowodem.** Ryzyka zakotwiczone w
   „zespół obawia się X, a awaria ujawniłaby się gdzieś w <obszarze>” mają
   taką samą wagę jak linie PRD lub dane hot-spotów.
3. **Ryzyka to scenariusze, nie miejsca w kodzie.** Ten plan dokumentuje,
   _co może zawieść_ i _dlaczego uważamy to za prawdopodobne_ — na podstawie
   dokumentów, wywiadu i _sygnału_ z bazy kodu (zmienność, struktura, baza
   testów). NIE twierdzi, że wie, która linia odpowiada za awarię. Tę wiedzę
   wytwarza `/10x-research` w każdym etapie wdrożenia. Jeśli plan i badanie
   różnią się co do miejsca awarii, prawdą jest badanie.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`, `scripts/` (bez `src/database.types.ts`, dokumentacji, `context/`, `.claude/` i wyników budowania; 29 commitów w ciągu 30 dni do 2026-11-17).

## 2. Risk Map

Najważniejsze scenariusze awarii, uporządkowane według ryzyka = wpływ ×
prawdopodobieństwo. Kolumna Source cytuje _dowód, który podniósł ryzyko_ —
nigdy konkretny plik jako „miejsce awarii” (patrz §1, zasada #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                      | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Klient widzi swoje zgłoszenie jako przyjęte („do realizacji”), a serwis nie ma go w kolejce — przy braku dopasowania, przy niedostępnym wyszukiwaniu i po oznaczeniu podpowiedzi jako niepomocnej.                           | High   | Medium     | wywiad Q1; PRD US-01 (kryteria akceptacji), FR-003, FR-004, FR-011; archive `2026-09-25-first-gated-error-resolution` (przegląd: błędne odpowiedzi pokazywane jako brak połączenia, porównanie duplikatów); archive `2026-10-19-mark-suggestion-unhelpful` (przegląd: kontrola duplikatu jako SELECT przed INSERT); hot-spot dir `src/components/error-resolution` (35 zmian/30d), `src/pages/admin` (10) |
| 2   | Wgrana dokumentacja ERP jest uszkodzona — fragmenty tekstu zgubione, ucięte lub sklejone z innymi stronami albo ponowne wgranie zostawia dokument w połowie; baza wiedzy podaje złe lub żadne podpowiedzi.                   | Medium | High       | wywiad Q3, Q4; PRD FR-012, Open Questions 3–4; brak jakichkolwiek testów procesu wgrywania; hot-spot dir `scripts/` (8 zmian/30d)                                                                                                                                                                                                                                                                         |
| 3   | Użytkownik firmy A odczytuje lub zapisuje dane firmy B, bo nowa tabela, grant lub funkcja otwiera lukę w izolacji.                                                                                                           | High   | Medium     | PRD Guardrails, NFR (izolacja firm); `lessons.md` (zabroniony zapis, domyślne granty Supabase); archive `2026-09-22-tenant-data-and-auth-foundation` (przeglądy: dziury zapisu niewykryte przez testy odczytu)                                                                                                                                                                                            |
| 4   | Tekst rozwiązania w bazie wiedzy ujawnia innym firmom dane identyfikujące klienta (nazwę firmy, osoby, numery).                                                                                                              | High   | Medium     | PRD Access Control (baza wiedzy wspólna dla wszystkich firm); archive `2026-10-14-service-staff-ticket-resolution` (przegląd: tekst serwisu bez sanitizacji, nazwa firmy maskowana tylko przy dokładnych odstępach); CLAUDE.md: filtr z założenia niekompletny                                                                                                                                            |
| 5   | Dopasowanie po cichu przestaje działać — wszystko kończy się zgłoszeniem albo pokazuje się niewłaściwa podpowiedź — po zmianie progu, rozjeździe modelu/wymiaru embeddingów między wgrywaniem a wyszukiwaniem lub ich braku. | Medium | Medium     | wywiad Q3; PRD FR-002, FR-012, Business Logic; tech-stack: model i wymiar embeddingów wspólne dla wgrywania i wyszukiwania (zmiana po jednej stronie unieważnia wszystkie wektory)                                                                                                                                                                                                                        |
| 6   | Anonimowy użytkownik lub klient dociera do stron albo API serwisu, lub po zalogowaniu zostaje przekierowany poza serwis.                                                                                                     | High   | Low        | archive `2026-10-29-polish-sign-in` (przegląd: zabronione prefiksy sprawdzane na niezdekodowanej ścieżce); CLAUDE.md: plik statyczny lub prerender pod chronionym prefiksem po cichu zdejmuje ochronę; roadmap S-04 Risk (open redirect)                                                                                                                                                                  |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                        | Must challenge                                                                                               | Context `/10x-research` must ground                                                                                                                            | Likely cheapest layer                                                            | Anti-pattern to avoid                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| #1   | Każde zgłoszenie widoczne dla klienta jako `todo` jest widoczne dla serwisu w kolejce — także przy niedostępnym wyszukiwaniu i eskalacji z komentarzem; błąd zapisu daje klientowi błąd, nie komunikat o sukcesie. | „200 oznacza, że zgłoszenie powstało”; „duplikat oznacza, że to samo zgłoszenie już jest w kolejce serwisu”. | Ścieżki zapisu (nowe, duplikat, eskalacja), co klient widzi przy błędzie zapisu, zapytanie kolejki serwisu (filtr firmy, stronicowanie, które firmy są ujęte). | integracja na lokalnym Supabase (rozszerzenie smoke) + unit dla reguły duplikatu | Sprawdzanie tylko odpowiedzi API bez odczytu kolejki serwisu; mockowanie bazy.                                      |
| #2   | Każdy fragment tekstu PDF trafia do dokładnie jednego fragmentu w bazie, bez ucięć, w poprawnej kolejności; przerwane wgrywanie nie zostawia dokumentu w połowie.                                                  | „Liczba fragmentów > 0 oznacza poprawne wgranie.”                                                            | Algorytm dzielenia, granice stron/rozmiaru, przypadki brzegowe (pusta strona, bardzo długa linia, polskie znaki), atomowość publikacji.                        | unit na przykładowych PDF-ach; integracja dla publikacji                         | Wartość oczekiwana skopiowana z wyniku obecnego algorytmu (problem wyroczni); snapshot całego wyniku bez znaczenia. |
| #3   | Dla każdej powierzchni zapis jako klient innej firmy i jako anon kończy się odmową — nie tylko odczyt.                                                                                                             | „Test odczytu wystarczy.”                                                                                    | Inwentarz tabel, funkcji i grantów; które powierzchnie nie mają jeszcze asercji zabronionego zapisu.                                                           | SQL w `rls.sql` (już w CI)                                                       | Testy tylko odczytu; testy wykonywane jako `service_role`.                                                          |
| #4   | Znane wzorce danych klienta (nazwa firmy w różnych zapisach, e-mail, telefon, NIP) nie trafiają do tekstu bazy wiedzy.                                                                                             | „Filtr działa, bo przechodzi przykład z planu.”                                                              | Zakres filtra i świadome luki; które pola trafiają do bazy wiedzy.                                                                                             | unit z korpusem przypadków wrogich                                               | Przypadki wyprowadzone z wyrażeń regularnych implementacji; tylko poprawne przykłady.                               |
| #5   | Stałe modelu i wymiaru po stronie wgrywania i wyszukiwania są równe; znany tekst błędu z wgranej dokumentacji daje dopasowanie powyżej progu.                                                                      | „Brak błędu wyszukiwania oznacza, że wyszukiwanie działa.”                                                   | Gdzie żyją stałe, jak działa próg, jak uruchomić zestaw kontrolnych błędów bez kosztu przy każdym PR.                                                          | unit (zgodność stałych); ręczny zestaw kontrolny z kluczem OpenAI                | Mock embeddingów, który zawsze „pasuje”.                                                                            |
| #6   | Po buildzie w artefakcie statycznym nie ma plików pod chronionymi prefiksami; złośliwe `next` (zakodowane, `//`, `\`) zawsze daje `/`.                                                                             | „Middleware chroni wszystko, co jest w stronach.”                                                            | Lista chronionych prefiksów, zawartość wyniku buildu, istniejące kroki smoke dla przekierowań.                                                                 | unit dla walidacji `next`; kontrola artefaktu buildu w CI                        | Testowanie tylko poprawnych ścieżek.                                                                                |

## 3. Phased Rollout

Każdy wiersz to osobny etap wdrożenia, który otwiera własny folder zmiany
przez `/10x-new`. Status przechodzi od lewej do prawej przez wartości
poniżej; orkiestrator aktualizuje go, gdy artefakty pojawiają się na dysku.

| #   | Phase name                           | Goal (one line)                                                                                                                                                          | Risks covered | Test types                                           | Status      | Change folder                |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ---------------------------------------------------- | ----------- | ---------------------------- |
| 1   | Zgłoszenie zawsze trafia do serwisu  | Udowodnić, że każde zgłoszenie widoczne dla klienta jest w kolejce serwisu (także bez wyszukiwania i przy eskalacji); wprowadzić runner jednostkowy i podłączyć go do CI | #1            | integration (smoke) + unit                           | complete    | testing-ticket-reaches-staff |
| 2   | Wgrywanie dokumentacji i dopasowanie | Udowodnić bezstratne dzielenie PDF, atomową publikację i zgodność modelu embeddingów między wgrywaniem a wyszukiwaniem                                                   | #2, #5        | unit (fixture PDF) + integration + manual golden set | not started | —                            |
| 3   | Izolacja firm i sanitizacja          | Domknąć zabronione zapisy na każdej powierzchni, wrogi korpus dla filtra bazy wiedzy i kontrolę ochrony stron serwisu                                                    | #3, #4, #6    | rls.sql + unit + build-artifact check                | not started | —                            |

Status vocabulary: `not started` → `change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

Klasyczna baza testów projektu. Rekomendacje opierają się na lokalnych
manifestach i konfiguracji oraz na narzędziach dostępnych w bieżącej sesji.

Profil bazy testów: **sparse** — Vitest od §3 Phase 1 (testy serwisu na lokalnym Supabase); obok dwie własne siatki uruchamiane w CI z lokalnym Supabase: smoke (przepływ logowania, izolacja firm, zgłoszenia) i `rls.sql` (zabronione zapisy dla każdej persony).

| Layer                  | Tool                                                         | Version | Notes                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit                   | Vitest (`npm test`) — checked: 2026-11-24                    | 5.1.1   | Integracyjne na lokalnym Supabase (seedowane persony), mock tylko OpenAI (`@/lib/openai`); czysty `vitest/config` z aliasem `@`, bez konfiguracji Astro (patrz §6.5). |
| integration (HTTP)     | `scripts/smoke.mjs` (Node, bez zależności)                   | —       | Działa na buildzie preview + lokalny Supabase; tworzy dane, które się kumulują (patrz CLAUDE.md).                                                                     |
| integration (DB / RLS) | `supabase/tests/rls.sql` (psql, jedna wycofywana transakcja) | —       | Liczby wierszy zakładają bazę po samym seedzie.                                                                                                                       |
| ingestion fixtures     | none yet — see Phase 2                                       | —       | `unpdf` jest devDependency, tylko w `scripts/`.                                                                                                                       |
| e2e (przeglądarka)     | none — celowo                                                | —       | Smoke pokrywa ścieżki krytyczne przez HTTP; wygląd stron wykluczony (§7).                                                                                             |
| AI-native              | none                                                         | n/a     | Brak ryzyka, w którym dodaje sygnał ponad testy deterministyczne.                                                                                                     |

**Stack grounding tools (current session):**

- Docs: none — Context7 / MCP dokumentacji not available in current session; wybór runnera zweryfikuje research Phase 1 w oficjalnej dokumentacji; checked: 2026-11-17
- Search: WebSearch (wbudowany) — nie użyto przy pisaniu planu; Exa.ai not available in current session; checked: 2026-11-17
- Runtime/browser: Claude in Chrome / przeglądarka wbudowana — not used (wygląd wykluczony, ścieżki krytyczne przez HTTP); checked: 2026-11-17
- Provider/platform: `gh` CLI (bez MCP); Supabase/Cloudflare MCP not available in current session — not used; checked: 2026-11-17

## 5. Quality Gates

| Gate                                                           | Where                         | Required?                 | Catches                                                          |
| -------------------------------------------------------------- | ----------------------------- | ------------------------- | ---------------------------------------------------------------- |
| lint + typecheck (`npm run lint`, `astro check`)               | local (lint-staged) + CI `ci` | required                  | dryf składni/typów, złamanie kontraktu UI                        |
| build                                                          | CI `ci`                       | required                  | błędy SSR/bundla                                                 |
| RLS denied writes (`rls.sql`)                                  | CI `smoke`                    | required                  | dziury izolacji i zapisu w bazie                                 |
| smoke (auth flow + izolacja + zgłoszenia)                      | CI `smoke`                    | required                  | zepsute ścieżki krytyczne przez HTTP                             |
| unit (`npm test`)                                              | local + CI `smoke`            | required                  | błędy logiki (duplikaty, dzielenie PDF, filtr, walidacja `next`) |
| ticket-reaches-staff check (`npm test` + smoke, kolejka po id) | CI `smoke`                    | required                  | zgłoszenie widoczne dla klienta, nieobecne w kolejce serwisu     |
| build-artifact gate check                                      | CI                            | required after §3 Phase 3 | plik statyczny pod chronionym prefiksem                          |
| golden-set matching                                            | local (z kluczem OpenAI)      | optional after §3 Phase 2 | regresja jakości dopasowania                                     |

## 6. Cookbook Patterns

Jak dodawać nowe testy w tym projekcie. Każda podsekcja jest wypełniana po
ukończeniu odpowiedniego etapu; wcześniej brzmi „TBD — see §3 Phase <N>”.

### 6.1 Adding a unit test

- **Location**: `src/**/*.test.ts`, obok testowanego modułu (np. `src/lib/services/<moduł>.test.ts`); `vitest.config.ts` zbiera tylko ten wzorzec.
- **Helper**: `src/test/supabase-personas.ts` — `signInAs("staff" | "alfa")` (klient `@supabase/supabase-js` z kluczem publishable/anon, zalogowany jako persona z `supabase/seed.sql`), stałe `COMPANY`/`PERSONA`, `findInStaffQueue(staff, ticketId, { companyId })` (przechodzi wszystkie strony kolejki serwisu). Nowa persona lub firma → dopisz ją tu, z wartościami z seeda.
- **Reference test**: `src/lib/services/error-resolution.test.ts` — serwis wołany bez trasy, z prawdziwą sesją persony; asercja `outcome` + `ticket.id`, potem odczyt kolejki serwisu sesją staff.
- **Rules**:
  - Mockuj wyłącznie `@/lib/openai` (`vi.mock` z fabryką, bez `importActual` — dzięki temu `astro:env/server` nigdy się nie ładuje). Baza jest prawdziwa; nigdy nie mockuj Supabase.
  - Nie importuj `@/lib/supabase` ani niczego, co czyta `astro:env/server`, poza zamockowanym `@/lib/openai`.
  - Tekst danych unikalny na przebieg (`crypto.randomUUID()` w treści) — baza się nie resetuje między przebiegami.
  - Asercje po id, nigdy po liczbie wierszy, pierwszej stronie ani samym kodzie 200 / `ok:true`.
  - Logowanie personami (`signInAs`) przy ładowaniu modułu (top-level `await`): brak Supabase ma oblać plik, nie pominąć go.
  - Odmowa zapisu: wywołaj prawdziwą odmowę RLS (np. sesja Alfy zapisująca dla firmy Beta), asertuj błąd zwrócony klientowi **i** zero wierszy odczytanych sesją staff (`lessons.md`).
  - Nigdy `service_role`, brak sprzątania danych; każdy przebieg zostawia zgłoszenia (budżet resetu — §6.5).
- **Run locally**: `npx supabase start`, `npx supabase db reset`, `SUPABASE_URL`/`SUPABASE_KEY` lokalnej instancji w `.env`, potem `npm test`. Brak zmiennych → błąd (nie pominięcie); host inny niż `localhost`/`127.0.0.1` → odmowa. W CI: job `smoke`, po `rls.sql`, przed buildem.

### 6.2 Adding a smoke (HTTP integration) step

- **Location**: `scripts/smoke.mjs` — tablica kroków `[opis, () => request(...), { status, check }]`, w sekcji przepływu, którego dotyczy (opis zaczynający się od `...` kontynuuje poprzedni krok).
- **Helper**: `findInStaffQueuePages(id, { company })` — przechodzi `/admin/tickets` jako staff strona po stronie (opcjonalnie z `?company=`), zwraca `found`, `pages`, `complete` i HTML strony, na której znaleziono zgłoszenie. Obecność: `check: ({ found }) => found`; nieobecność: `check: walkedWithout` (pełne przejście bez znalezienia i bez błędu kolejki).
- **Rule**: kolejka serwisu zawsze po id zgłoszenia i przez wszystkie strony — nigdy „jest na pierwszej stronie” ani wyszukiwanie po tekście w całej stronie; tekst (np. komentarz) sprawdzaj tylko na stronie zwróconej przez helper. Dane unikalne na przebieg (`runId`).
- **Run locally**: `npx supabase db reset`, `npm run build && npm run preview`, potem `npm run smoke` (`BASE_URL`, domyślnie `http://localhost:4321`). W CI: job `smoke` po `npm test`.

### 6.3 Adding an ingestion test with a fixture PDF

- TBD — see §3 Phase 2 (wzorzec: tekst PDF zachowany bez strat i w kolejności; przerwana publikacja nie zostawia dokumentu w połowie).

### 6.4 Adding an RLS denied-write check

- **Location**: `supabase/tests/rls.sql`, w bloku persony, której dotyczy odmowa.
- **Rule**: dla każdej nowej tabeli, grantu lub funkcji asertuj odmowę zapisu (insert/update/delete) w tej samej zmianie, która tworzy powierzchnię (`lessons.md`).
- **Run locally**: `npx supabase db reset`, potem `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql`.
- Uzupełnienie wzorca dla filtra bazy wiedzy i bramki buildu: TBD — see §3 Phase 3.

### 6.5 Per-rollout-phase notes

(Po każdym etapie `/10x-implement` dopisuje tu 2–3 linie o tym, czego etap nauczył.)

- **Phase 1 (`testing-ticket-reaches-staff`, 2026-11-24)**: `getViteConfig()` z `astro/config` ładuje adapter `@astrojs/cloudflare`, który startuje workerd i pada („module is not defined”) — dlatego `vitest.config.ts` to czysty `defineConfig` z `vitest/config` z aliasem `@` i tylko `SUPABASE_URL`/`SUPABASE_KEY` w `test.env`.
- Budżet lokalnej bazy: pierwsza strona `/api/tickets` (50, najnowsze pierwsze) mieści ~49 nowszych zgłoszeń Alfy, zanim seedowane zgłoszenie z niej wypadnie; `npm test` dodaje ~4, smoke 2 — `npx supabase db reset` co kilka par `npm test` + smoke. Kolejka serwisu nie ma już limitu (wyszukiwanie po id przez strony).
- Ścieżka błędu zapisu nie jest osiągalna przez HTTP (bramka przepuszcza tylko klienta własnej firmy); test wywołuje serwis z obcą firmą, żeby dostać prawdziwą odmowę RLS.

## 7. What We Deliberately Don't Test

- **Wygląd stron (zrzuty ekranu, snapshoty UI, wizualne diffy, przegląd multimodalny)** — wystarczą kitchen sink `/dev/ui-kitchen-sink` i ręczny przegląd; reguły kontraktu UI egzekwuje lint. Re-evaluate if regresje wizualne zaczną trafiać na produkcję. (Source: Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-11-17
- Stack versions last verified: 2026-11-24
- AI-native tool references last verified: 2026-11-17

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
