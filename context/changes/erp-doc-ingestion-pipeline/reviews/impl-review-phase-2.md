<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: ERP Documentation Ingestion Pipeline

- **Plan**: context/changes/erp-doc-ingestion-pipeline/plan.md
- **Scope**: Phase 2 of 4
- **Reviewed phases**: 2
- **Date**: 2026-09-24
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success criteria evidence

- 2.1 `npm run lint` — exit 0; 0 errors, 7 warnings, none of them in `scripts/` (`npx eslint scripts` is clean).
- 2.2 `npm run build` — exit 0; `grep -rli "unpdf\|pdfjs" dist` finds nothing.
- 2.3 `npm run ingest -- --pomoc` — exit 0, prints the Polish usage text.
- 2.4 `npm run ingest -- --dry-run nieistniejacy.pdf` — prints "Nie znaleziono: nieistniejacy.pdf — pominięto." and exits 1.
- 2.5–2.7 (manual) are ticked in dde7409. The commit message's note about TOC dot leaders on the real document points to a real run. This review did not re-check them.
- These checks ran on Node v24.19.0 locally. `.nvmrc` pins 22.14, which is what staff will run.
- Synthetic chunker check: `seq` values are contiguous, every fragment is a verbatim slice of the joined text, page ranges are correct across an empty page, and a fragment starts mid-word only after a hard cut inside a single token longer than 1600 characters, which the code documents.

## Findings

### F1 — `realpath` outside try aborts the whole run

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/ingest-erp-docs.mjs:77
- **Detail**: `expandInputs` protects `stat` and `readdir` with try/catch, but `await realpath(filePath)` in the dedupe loop has none. If it rejects (the file was removed or renamed between `stat` and `realpath`, a broken junction, or a permission error on a path component), the exception skips every per-file handler. The top-level catch then prints "BŁĄD: Nieoczekiwany błąd: ENOENT…" with a raw English errno and ends the run before any file is processed. The plan requires "continuing past per-file failures". Phase 3 will reuse `expandInputs`, so a real load would abort the same way.
- **Fix**: Wrap `realpath` in try/catch and on failure print `MSG.inputUnreadable(filePath)`, add `printError`, then `problems++; continue;`, following the `stat` branch above it.
- **Decision**: FIXED

### F2 — Duplicate base-name detection not in the plan

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: scripts/ingest-erp-docs.mjs:72-88
- **Detail**: `expandInputs` rejects a second file with the same case-insensitive base name, and a folder with no PDFs counts as a failure (exit 1). Neither behaviour is in the Phase 2 contract. Both are harmless and the first one follows directly from the plan's decision that "identity = lower(base name)". Without it, two such files in one run would publish over each other in Phase 3. This is an EXTRA change that should be recorded, not removed.
- **Fix**: Add a one-line addendum to Phase 2 §2 in plan.md saying that same-name inputs are rejected and that an empty folder counts as a failure.
- **Decision**: FIXED

### F3 — Node prints an English notice on every run without `.env.ingest`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: package.json:14
- **Detail**: `--env-file-if-exists=.env.ingest` makes Node itself write ".env.ingest not found. Continuing without it." to stderr. `--dry-run` is documented as working "bez kluczy", so every staff dry-run without the file shows this English line before the Polish output. The plan requires "Polish for every user-facing line". It is harmless, but it may confuse the non-developer audience the plan is written for.
- **Fix**: In Phase 3, when writing the config loading, replace the flag with `process.loadEnvFile(".env.ingest")` inside a try that ignores ENOENT. Otherwise, mention the line in the Phase 4 runbook.
- **Decision**: QUEUED for Phase 3 in follow-ups/review-fixes.md (the config loader does not exist yet)

### F4 — Extraction-quality limitation recorded only in a commit message

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: N/A (commit dde7409 message)
- **Detail**: The dry run on the real document showed that TOC dot leaders and the repeated page header survive extraction and dilute fragments. Page headers are already under "What We're NOT Doing", but TOC dot leaders are not, and the only record is the commit message. S-01 will judge match quality from the plan and roadmap, not from git log.
- **Fix**: Add one sentence under the plan's "What We're NOT Doing" (or the roadmap's S-01 notes) saying TOC dot leaders are kept for now and to revisit if match quality is poor.
- **Decision**: FIXED
