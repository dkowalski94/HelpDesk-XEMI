---
change_id: service-staff-ticket-resolution
title: Service staff ticket resolution
status: implementing
created: 2026-10-14
updated: 2026-10-19
---

## Notes

Roadmap item **S-02** (`context/foundation/roadmap.md`) — closes the core loop: service staff
see every client company's to-do tickets, record cause + steps, and the resolution feeds the
shared knowledge base for future matches (FR-004, FR-005, FR-006, FR-008).

Change folder created by `/10x-plan` (mirroring `/10x-new` semantics); `/10x-new` was
never run for this item.

## Sanitizer samples (manual step 2.8, 2026-10-19)

Real XEMI messages supplied by the user, run through `sanitizeErrorText` with no company name.
The user accepted two samples instead of the planned 3–5.

| Input | Output |
| --- | --- |
| `Brak uprawnień do zmiany dokumentu na stan zreazliowany, KOWALSKI DAWID bierze już udział w wyjeździe/spotkaniu:,` | `Brak uprawnień do zmiany dokumentu na stan zreazliowany, [osoba] bierze już udział w wyjeździe/spotkaniu:,` |
| `Nie można zmienić daty oddziału, dokumenty są w stanie otwartym` | unchanged (no company data) |

Findings:

- The first sample originally passed through unchanged: XEMI embeds an employee's name as
  `NAZWISKO IMIĘ` in capitals, which no planned rule covered. By user decision, rule 9 (`[osoba]`)
  was added: two or more consecutive all-caps words. Its accepted cost: an all-caps phrase that is
  not a person (e.g. a module name) is masked too.
- Residual risk: a name in normal case (`Kowalski Dawid`) still passes through.
- `wyjeździe/spotkaniu` is correctly not a document number (no digit).
- Neither real sample carries a numeric error code, so the "codes are at most 4 digits" assumption
  for the `[liczba]` rule is still unverified on real data.

These inputs and outputs are the first fixtures once a test runner exists.
