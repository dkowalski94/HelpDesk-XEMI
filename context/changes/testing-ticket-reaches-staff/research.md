---
date: 2026-11-18T09:12:07+01:00
researcher: Claude (Opus 5.5)
git_commit: 956e1fc
branch: master
repository: Projekt_Dawid
topic: "Test-plan Phase 1 — zgłoszenie klienta zawsze trafia do kolejki serwisu (ryzyko #1)"
tags: [research, testing, tickets, error-resolution, escalation, staff-queue, smoke, vitest]
status: complete
last_updated: 2026-11-18
last_updated_by: Claude (Opus 5.5)
---

# Research: Phase 1 — „Zgłoszenie zawsze trafia do serwisu”

**Date**: 2026-11-18T09:12:07+01:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: 956e1fc (drzewo robocze z niezatwierdzonymi zmianami UI; żaden z cytowanych plików ścieżki zapisu nie jest zmodyfikowany wg `git status`)
**Branch**: master
**Repository**: Projekt_Dawid

## Research Question

Ugruntować ryzyko #1 z `context/foundation/test-plan.md` §2: klient widzi zgłoszenie jako przyjęte, a serwis nie ma go w kolejce — przy braku dopasowania, przy niedostępnym wyszukiwaniu i po eskalacji („podpowiedź nie pomogła”). Zweryfikować wytyczne odpowiedzi (§2 Risk Response Guidance, wiersz #1), zakwestionować „200 = zgłoszenie powstało” i „duplikat = to samo zgłoszenie jest w kolejce serwisu”, zlokalizować istniejące testy, wskazać najtańszą warstwę testu i wybrać runner jednostkowy zgodny z Astro/Vite i Node 22.

## Summary

1. **Wszystkie trzy ścieżki zbiegają się w jednej funkcji.** Brak dopasowania (`search.status === "ok"`, 0 trafień) i niedostępne wyszukiwanie (`"unavailable"`) przechodzą do tego samego `fileTicket(...)` (`src/lib/services/error-resolution.ts:172-178`); eskalacja woła ten sam `fileTicket` z komentarzem (`:210`). Różnią się tylko flagą `searchUnavailable` (`:176`, `:182`) i komentarzem.
2. **Błąd zapisu daje klientowi błąd, nie sukces — w sprawdzonej ścieżce kodu.** Błąd INSERT → `fileTicket` zwraca `null` (`:149-152`) → `{ ok: false, reason: "error" }` (`:179-181`, `:211-213`) → HTTP 500 (`src/pages/api/resolve-error.ts:12,70`; `src/pages/api/escalate-error.ts:13,83`). Wyspa rozstrzyga sukces po `payload.ok`, nie po statusie HTTP, i pokazuje `payload.error` (`src/components/error-resolution/ErrorResolutionPanel.tsx:110-118` i `:46-53`). **Ta ścieżka nie ma dziś żadnego testu.**
3. **„200 oznacza, że zgłoszenie powstało” jest fałszywe.** 200 zwracają trzy różne wyniki: `matched` (żadne zgłoszenie nie powstaje, `:173-175`), `already-reported` (żaden nowy wiersz, `:139-140`) i `ticket-created`. Test musi sprawdzać `outcome` + `ticket.id`, a potem odczytać kolejkę serwisu.
4. **„Duplikat oznacza to samo zgłoszenie w kolejce serwisu” jest prawdziwe z warunkami.** Wyszukanie duplikatu filtruje `created_by = caller`, `status = 'todo'`, dokładny `error_text` (`:127-135`), więc zwrócony wiersz jest `todo`; staff widzi każdy wiersz `tickets` (polityka SELECT, `supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:248-259`), a kolejka to `status = 'todo'` bez filtra rodzaju firmy (`src/lib/services/ticket-resolution.ts:83-86`). Wyjątki (żaden nie gubi zgłoszenia): wyścig z rozwiązaniem między lookupem a odpowiedzią; błąd lookupu → nowy duplikat (`:126`, `:137-138`); komentarz drugiej eskalacji jest odrzucany (świadomie, `:116-118`).
5. **W kodzie nie znaleziono ścieżki, w której klient dostaje `ticket-created`/`already-reported`, a wiersza nie ma w kolejce** (poza wyścigiem z rozwiązaniem). Ryzyko #1 jest więc dziś **ryzykiem regresji**, nie potwierdzonym defektem. Realny, obecny słaby punkt to **siatka testów**: smoke sprawdza kolejkę tylko na pierwszej stronie (oldest-first, 50 na stronę) i z czasem przestaje widzieć nowe zgłoszenia.
6. **Najtańsza użyteczna warstwa**: (a) rozszerzenie smoke o odczyt kolejki serwisu **po identyfikatorze zgłoszenia, z przechodzeniem przez strony**, dla trzech ścieżek; (b) test Vitest wywołujący `resolveError`/`escalateUnhelpful` z **prawdziwym klientem Supabase** zalogowanym jako persona, na lokalnym Supabase — w tym wymuszenie prawdziwej odmowy RLS przy INSERT, żeby sprawdzić ścieżkę błędu zapisu bez mockowania bazy.
7. **Runner**: Vitest. `vitest@5.1.1` (npm, 2026-11-18) ma `peerDependencies.vite = ^6.4.0 || ^7.0.0 || ^8.0.0` i `engines.node = ^22.12.0 || ^24.0.0 || >=26.0.0`; repo ma `vite@8.3.0`, `astro@7.3.2`, `.nvmrc` 22.14.0 → zgodne. Dokumentacja Astro (docs.astro.build/en/guides/testing) zaleca Vitest z `getViteConfig()` z `astro/config`. **Niezweryfikowane**: czy `getViteConfig()` z adapterem `@astrojs/cloudflare` rozwiązuje `astro:env/server` pod Vitest w Node — serwis importuje go pośrednio (`src/lib/openai.ts:1`).
8. **Dowód hot-spotów jest częściowo mylący.** `src/components/error-resolution` miał 9 commitów od 2026-10-18 (liczba „35” w planie to najpewniej zmiany plików, nie commity), prawie wyłącznie kontrakt UI/stylowanie; logika zapisu żyje w `src/lib/services/error-resolution.ts` (2 commity w tym oknie), `src/pages/api/resolve-error.ts` (0), `src/pages/api/escalate-error.ts` (1). `src/pages/admin/tickets.astro` (7 commitów) jest istotny — m.in. filtr firmy (`staff-ticket-company-filter`).

## Detailed Findings

### Ścieżki zapisu (nowe, duplikat, eskalacja)

- Walidacja wspólna: `checkErrorText` normalizuje CRLF→LF i przycina (`src/lib/services/error-resolution.ts:95-113`); dokładnie ten przycięty tekst jest kluczem duplikatu (`:132`) i treścią wiersza (`:145`). Formularz multipart wysyła CRLF, wyspa liczy LF — normalizacja decyduje, czy ten sam błąd wklejony dwa razy jest duplikatem.
- `fileTicket` (`:120-155`):
  ```ts
  // A lookup error is treated as "not found": a duplicate ticket beats a lost report.
  .eq("created_by", userId).eq("status", "todo").eq("error_text", trimmedText)
  ...
  .insert({ company_id: companyId, created_by: userId, error_text: trimmedText, user_comment: comment })
  .select(TICKET_COLUMNS).single();
  if (insertError) { console.error(...); return null; }
  ```
- `resolveError` (`:162-183`): `matched` tylko gdy `search.status === "ok" && matches.length > 0`; każdy inny przypadek pliku zgłoszenie. `searchKnowledgeBase` nigdy nie rzuca — brak klucza, błąd OpenAI, timeout, błąd RPC → `unavailable` (`:36-62`).
- `escalateUnhelpful` (`:190-215`): bez wyszukiwania; `comment || null` (`:210`); komentarz za długi → 400 przed zapisem (`:201-208`).
- Warunki brzegowe INSERT po stronie bazy: polityka wymaga `company_id = current_company_id()`, rodzaju `client`, `created_by = auth.uid()` (`20260922120100_tickets_and_knowledge_base.sql:263-271`); trigger `enforce_ticket_company_kind()` odrzuca firmę inną niż `client` (`:184-218`); grant INSERT tylko na `company_id, created_by, error_text, user_comment` (`:358-359`), `status` ma default `'todo'` (`:81`). Nowy wiersz jest więc zawsze `todo` w firmie typu `client`.
- Wniosek (nie testowany): `.select(...)` po INSERT wymaga, by nowy wiersz przeszedł politykę SELECT klienta — dla własnej firmy przechodzi (`:248-259`), więc „zapisano, ale zwrócono błąd” nie powinno wystąpić w tej konfiguracji.

### Co klient widzi przy błędzie zapisu

- Trasy: bramka (401 / 500 `profileLookupFailed` / 403 `not-a-client` / 503) przed jakimkolwiek zapisem (`src/pages/api/resolve-error.ts:25-54`, `src/pages/api/escalate-error.ts:35-56`), potem `json(result, result.ok ? 200 : FAILURE_STATUS[result.reason])`.
- Wyspa: nie-JSON (np. strona HTML 502) → „Wystąpił błąd serwera…”; wyjątek `fetch` → „Nie udało się połączyć z serwerem…”; `ok:false` → `payload.error` (`ErrorResolutionPanel.tsx:43-55`, `:107-120`). Komunikaty sukcesu („Przekazaliśmy błąd do zespołu serwisowego XEMI”, „…czeka na zespół serwisowy”) renderują się wyłącznie dla `ok:true` (`src/components/error-resolution/ResolutionOutcome.tsx:82-106`, `EscalationControl.tsx:55-76`).
- Ścieżki błędu INSERT **nie da się wywołać przez HTTP** seedowanymi personami: bramka trasy przepuszcza tylko `client_user` firmy `client`, a dla takiego konta INSERT z `profile.companyId` przechodzi RLS. Wymusić ją można tylko poniżej trasy — wywołując serwis z `caller.companyId` innej firmy niż firma zalogowanej persony (prawdziwa odmowa RLS, bez mocka).

### Kolejka serwisu (`/admin/tickets`)

- Zapytanie: `tickets` `status = 'todo'`, opcjonalnie `company_id`, `created_at ASC, id ASC`, `range(offset, offset + 50)` (`src/lib/services/ticket-resolution.ts:79-110`, `STAFF_QUEUE_PAGE_SIZE = 50` w `:9`). Brak filtra rodzaju firmy — poprawność opiera się na RLS staff (`is_service_staff()`) i triggerze rodzaju firmy.
- Które firmy: lista filtra to `companies.kind = 'client'` z liczbą `todo` (`:117-131`); parametr `company` przyjmowany tylko jako UUID z tej listy (albo dowolny UUID, gdy lista się nie wczytała) — inaczej wszystkie firmy (`src/pages/admin/tickets.astro:53-59`).
- Stronicowanie: najstarsze pierwsze, więc **nowe zgłoszenie trafia na ostatnią stronę**; strona daje tylko link „następna” (`tickets.astro:66-69`). `max_rows = 1000` (`supabase/config.toml:18`) > 51, więc PostgREST nie przycina strony.
- Nazwa firmy z osadzenia `companies ( name )`; brak → „Nieznana firma” (`src/components/admin/StaffTicketQueue.astro:147`) — wiersz i tak się wyświetla.

### Istniejące testy

- `scripts/smoke.mjs` (CI job `smoke`, `.github/workflows/ci.yml:27-57`, bez `OPENAI_API_KEY`):
  - `:485-498` resolve-error → `ticket-created`, firma Alfa, tekst; **nie sprawdza `searchUnavailable`**. W CI to zawsze ścieżka „wyszukiwanie niedostępne” (brak klucza); lokalnie z kluczem — ścieżka „brak dopasowania”. Ścieżka „brak dopasowania przy działającym wyszukiwaniu” nie jest więc nigdy wykonywana w CI (logika zapisu jest ta sama, `:178`).
  - `:500-510` duplikat → `already-reported`, ten sam `ticket.id`.
  - `:584-610` eskalacja z komentarzem → `ticket-created`; druga eskalacja → `already-reported`, ten sam id.
  - `:612-640` kolejka staff zawiera pierwszy komentarz, nie drugi; filtr Alfa zawiera, Beta nie — **dopasowanie po tekście komentarza, nie po id**, i **tylko pierwsza strona**.
  - `:673-677` „staff queue lists the ticket” — `inQueue` po `name="ticketId" value=` (`:198`), **tylko pierwsza strona** (komentarz `:672`, nagłówek `:6-14`: psuje się po ~49 przebiegach bez resetu bazy).
  - Brak kroku dla błędu zapisu.
- `supabase/tests/rls.sql`: INSERT klienta do własnej firmy dozwolony (kontrola, `:339-340`), do obcej/wewnętrznej/już rozwiązany/cudze autorstwo/bez autora — odmowa (`:342-358`); widoczność klienta (`:328-331`). Nie sprawdza widoczności dla staff świeżo wstawionego wiersza (to robi smoke).
- Brak runnera jednostkowego i jakichkolwiek plików `*.test.*` w `src/` (manifest: brak `vitest`/`jest` w `package.json` i `node_modules`).

### Runner jednostkowy

- Astro: „Vitest … Vite-native unit test framework”; konfiguracja `vitest.config.ts` przez `getViteConfig({ test: {...} })` z `astro/config`, który „will try to load an Astro config file” (docs.astro.build/en/guides/testing, odczyt 2026-11-18). Strona nie wspomina `astro:env`.
- Vitest guide: „Vitest requires Vite >=v6.4.0 and Node >=v22.12.0” (vitest.dev/guide, 2026-11-18); `npm view vitest@latest` → 5.1.1, peer vite `^6.4.0 || ^7.0.0 || ^8.0.0`.
- Do rozstrzygnięcia w planie (spike): `getViteConfig` + `@astrojs/cloudflare` pod Vitest — rozwiązanie `astro:env/server` (`src/lib/openai.ts:1`, `src/lib/supabase.ts:3`) i to, czy adapter nie próbuje uruchomić workerd. Alternatywa, jeśli się nie da: test nie importuje `src/lib/supabase.ts` (tworzy klienta `@supabase/supabase-js` sam), a `astro:env/server` aliasuje się w konfiguracji Vitest.

## Weryfikacja wytycznych odpowiedzi (§2, wiersz #1)

| Wytyczna | Werdykt | Uwagi |
|---|---|---|
| Każde zgłoszenie `todo` widoczne dla klienta jest w kolejce serwisu | Utrzymana | Udowadniać po **id** i z przechodzeniem przez strony (lub filtrem firmy + stronicowaniem), nie po tekście na pierwszej stronie. |
| Także przy niedostępnym wyszukiwaniu | Utrzymana, doprecyzowana | W CI każdy ticket to już ta ścieżka; dodać asercję `searchUnavailable === true` w CI, by nazwać ścieżkę jawnie. „Brak dopasowania przy działającym wyszukiwaniu” wymaga klucza OpenAI — poza CI; konwergencja w `fileTicket` czyni to ryzyko niskim. |
| Eskalacja z komentarzem | Utrzymana | Dodać sprawdzenie kolejki po `escalationTicketId`, nie tylko po tekście komentarza. |
| Błąd zapisu → błąd, nie sukces | Utrzymana, korekta warstwy | Nieosiągalna przez HTTP; najtańszy prawdziwy sygnał: Vitest wywołujący serwis z prawdziwym klientem i `companyId` obcej firmy (odmowa RLS). Kontrakt wyspy (`payload.ok`) — tylko odczyt kodu; §7 wyklucza testy wyglądu. |
| „200 = zgłoszenie powstało” | Słusznie kwestionowane | 200 także dla `matched` i `already-reported`. |
| „Duplikat = to samo zgłoszenie w kolejce” | Prawdziwe z warunkami | Patrz Summary pkt 4. |
| Unit dla reguły duplikatu (§2 „Likely cheapest layer”) | Korekta | Reguła duplikatu to zapytanie do bazy, nie czysta funkcja; czysto jednostkowa jest tylko normalizacja (`checkErrorText`, nieeksportowana). „Unit” = Vitest na prawdziwym lokalnym Supabase. |
| Nie mockować bazy | Utrzymana | Wszystkie powyższe propozycje działają na lokalnym Supabase. |

## Code References

- `src/lib/services/error-resolution.ts:95-113` — normalizacja i walidacja tekstu (klucz duplikatu)
- `src/lib/services/error-resolution.ts:120-155` — `fileTicket`: lookup duplikatu, INSERT, `null` przy błędzie
- `src/lib/services/error-resolution.ts:162-183` — `resolveError`: matched / unavailable / no-match → `fileTicket`
- `src/lib/services/error-resolution.ts:190-215` — `escalateUnhelpful`
- `src/pages/api/resolve-error.ts:6-13,64-70` — mapowanie `reason` → status
- `src/pages/api/escalate-error.ts:6-14,76-83` — to samo dla eskalacji
- `src/components/error-resolution/ErrorResolutionPanel.tsx:43-55,107-120` — sukces po `payload.ok`
- `src/lib/services/ticket-resolution.ts:79-131` — kolejka `todo` i lista firm
- `src/pages/admin/tickets.astro:43-69` — offset, filtr firmy, link następnej strony
- `supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:69-111,184-218,248-271,358-359` — tabela, trigger rodzaju firmy, polityki, grant INSERT
- `scripts/smoke.mjs:485-510,584-640,672-677` — obecne kroki zgłoszeń i kolejki
- `supabase/tests/rls.sql:328-358` — widoczność i odmowy INSERT

## Architecture Insights

- Jedno wąskie gardło zapisu (`fileTicket`) i jedna ścieżka odczytu kolejki (`listTodoQueue`) — test na tych dwóch granicach pokrywa wszystkie trzy scenariusze ryzyka.
- Serwisy przyjmują `SupabaseClient` i `caller` jako argumenty — pozwala to testować je z prawdziwym klientem persony bez trasy i bez mocka.
- Smoke jest celowo bez zależności i kumuluje dane; testy kolejki muszą być odporne na dane z wcześniejszych przebiegów (id + stronicowanie), inaczej każda poprawka zostanie z czasem cicho unieważniona.

## Historical Context (from prior changes)

- Archiwa przywołane przez test-plan jako źródła ryzyka: `context/archive/2026-09-25-first-gated-error-resolution/`, `context/archive/2026-10-19-mark-suggestion-unhelpful/`, `context/archive/2026-10-14-service-staff-ticket-resolution/`, `context/archive/2026-10-28-staff-ticket-company-filter/` — nie czytane ponownie w tym badaniu; obecne zachowanie ustalono z kodu. Twierdzenie planu o „kontroli duplikatu jako SELECT przed INSERT”: **potwierdzone** (`error-resolution.ts:127-147`, brak ograniczenia unikalności) — skutek to możliwy duplikat przy współbieżności, nie utrata zgłoszenia.
- `lessons.md`: „assert the denied write” — dotyczy Phase 3; tutaj wykorzystane jako sposób wymuszenia błędu zapisu (prawdziwa odmowa RLS).

## Related Research

Nie dotyczy (brak innych `research.md` dla tego obszaru w `context/changes/`).

## Open Questions

1. Czy `getViteConfig()` z adapterem `@astrojs/cloudflare` działa pod Vitest 5 i rozwiązuje `astro:env/server`? (spike w pierwszej fazie planu)
2. Czy test Vitest na lokalnym Supabase ma iść do istniejącego joba CI `smoke` (już ma Supabase), czy do osobnego kroku — i jak izolować jego dane (tickety się kumulują, brak DELETE)?
3. Czy w CI warto dodać krok z kluczem OpenAI dla ścieżki „brak dopasowania przy działającym wyszukiwaniu”? (koszt vs. niski sygnał przy wspólnym `fileTicket`)
4. Czy smoke ma szukać zgłoszenia przez stronicowanie `/admin/tickets`, czy przez filtr firmy + stronicowanie — decyzja planu.
