---
change_id: first-gated-error-resolution
title: First gated error resolution
status: archived
created: 2026-09-25
updated: 2026-10-14
archived_at: 2026-10-14T06:45:08Z
---

## Notes

Roadmap item **S-01** (`context/foundation/roadmap.md`) — the milestone's north star: a client
user pastes an ERP error and gets a matched suggestion or an auto-escalated ticket.

Change folder created by `/10x-plan` (mirroring `/10x-new` semantics); `/10x-new` was
never run for this item.

**Deferred (3.12, 2026-10-13):** threshold calibration postponed by the user — the only
ingested document (`Instrukcja-xemi-sprzedaz.pdf`) holds few literal error messages, so
the samples are not representative. `MATCH_THRESHOLD` stays 0.5; recorded similarities
are next to the constant in `src/lib/services/error-resolution.ts`. Revisit near the end
of the project with better documentation.
