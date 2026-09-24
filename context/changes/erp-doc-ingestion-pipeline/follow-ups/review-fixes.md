# Review fixes — queued

Follow-ups from implementation reviews that belong to a later phase.

## Phase 3 — from impl-review-phase-2 F3

- **What**: Remove `--env-file-if-exists=.env.ingest` from the `ingest` script in `package.json`. In the Phase 3 config loader (`scripts/ingest/upload.mjs`), call `process.loadEnvFile(".env.ingest")` inside a try that ignores `ENOENT` and lets any other error through.
- **Why**: With the flag, Node itself prints ".env.ingest not found. Continuing without it." in English on every keyless `--dry-run`, and the plan says every user-facing line is Polish.
- **Check**: `npm run ingest -- --pomoc` without `.env.ingest` prints only Polish, and a real load with a missing variable still names it (criterion 3.3).
