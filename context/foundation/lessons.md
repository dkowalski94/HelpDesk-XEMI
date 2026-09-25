# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Nie dodawaj lodash bez jawnego powodu

- **Context**: Implementacja funkcji w aplikacji TypeScript po stronie frontendu i backendu.
- **Problem**: Agent użył `_.filter()`, mimo że lodash nie jest częścią projektu. To dodałoby niepotrzebną zależność i rozjechało lokalną konwencję pracy z natywnymi API.
- **Rule**: Nie dodawaj lodash bez jasnego wskazania. Projekt preferuje natywne funkcje JS/TS w standardzie 2026+.
- **Applies to**: plan, implement, impl-review

## Assert the denied write on every RLS surface, in the phase that creates it

- **Context**: Any phase that creates or changes an RLS-protected surface: a Postgres table with row level security, a policy, or a `SECURITY DEFINER` view or function — `supabase/migrations/*.sql`.
- **Problem**: Phase 2 of `tenant-data-and-auth-foundation` shipped success criteria that all tested reads ("returns 0 rows", "is not selectable by anon"). A definer-rights view stayed auto-updatable and writable by every logged-in user — a client could wipe the entire shared knowledge base in one request — and two column-grant gaps let a client forge a resolved ticket attributed to real staff, and let staff move a ticket into another tenant. All three passed every gate the phase defined.
- **Rule**: For every RLS-protected surface, assert the denied WRITE (insert, update, delete), not only the denied read — in the same phase that creates the surface, never deferred to a later verification phase. A read-only test suite cannot see a write hole.
- **Applies to**: all

## Odbieraj domyślne uprawnienia Supabase w migracji, która tworzy obiekt

- **Context**: Każda migracja Supabase tworząca tabelę, widok lub funkcję w schemacie `public`.
- **Problem**: Domyślne uprawnienia Supabase dają `anon`/`authenticated` ALL (w tym `TRUNCATE`, który omija RLS) i EXECUTE na funkcjach; migracje 1 i 2 zawęziły INSERT/UPDATE ręcznie, ale pominęły `TRUNCATE`/`TRIGGER`/`REFERENCES` i granty `anon` — znalezione dopiero w przeglądzie 2.12.
- **Rule**: Każdy nowy obiekt w `public` musi w tej samej migracji jawnie odebrać domyślne uprawnienia Supabase — `TRUNCATE`, `TRIGGER`, `REFERENCES` i wszystko dla `anon` na tabelach, EXECUTE od `public`/`anon` na funkcjach — a potem nadać z powrotem tylko to, czego wymaga polityka; weryfikuj przez `information_schema.role_table_grants`, nie przez czytanie SQL.
- **Applies to**: plan, implement, impl-review

## Backfill istniejących wierszy w migracji, która dodaje tabelę utrzymywaną triggerem

- **Context**: Każda migracja Supabase, która tworzy tabelę wypełnianą triggerem na `auth.users` albo innej istniejącej tabeli — np. `public.profiles` z `on_auth_user_created`.
- **Problem**: Trigger `AFTER INSERT` tworzy wiersz tylko dla nowych kont; konta już istniejące na hostowanej bazie zostają bez profilu. Na produkcji konto sprzed migracji `20260922120000` nie miało profilu, więc `is_service_staff()` było false, a `update` roli zmienił 0 wierszy (znalezione w `erp-doc-ingestion-pipeline`, krok 4.6, 2026-09-25). `db reset` + seed tego nie pokaże, bo seed wstawia `auth.users` po migracjach.
- **Rule**: Migracja, która dodaje tabelę lub kolumnę utrzymywaną triggerem na istniejącej tabeli, musi w tym samym pliku zrobić backfill dla istniejących wierszy (np. `insert … select from auth.users … on conflict do nothing`) i to sprawdzić — lokalnie przez wiersz w `auth.users` wstawiony przed migracją, nie przez seed.
- **Applies to**: plan, implement, impl-review
