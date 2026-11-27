---
change_id: testing-ticket-reaches-staff
title: Testy — zgłoszenie klienta zawsze trafia do kolejki serwisu (Phase 1)
status: archived
created: 2026-11-17
updated: 2026-11-27
archived_at: 2026-11-27T08:58:18Z
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Zgłoszenie zawsze trafia do serwisu".
Risks covered: #1 (klient widzi zgłoszenie jako przyjęte, a serwis nie ma go w kolejce — przy braku dopasowania, niedostępnym wyszukiwaniu i eskalacji). Test types planned: integration (smoke) + unit; wprowadzić runner jednostkowy i podłączyć go do CI.
Risk response intent: #1 — udowodnić, że każde zgłoszenie widoczne dla klienta jako `todo` jest w kolejce serwisu (także przy niedostępnym wyszukiwaniu i eskalacji z komentarzem), a błąd zapisu daje klientowi błąd, nie komunikat o sukcesie; zakwestionować „200 oznacza, że zgłoszenie powstało” i „duplikat oznacza, że to samo zgłoszenie już jest w kolejce serwisu”.
After creating the folder, follow the downstream continuation rule.
