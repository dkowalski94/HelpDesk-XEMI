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
