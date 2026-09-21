---
starter_id: 10x-astro-starter
package_manager: npm
project_name: helpdesk-xemi
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

HelpDesk XEMI is a web app for a multi-tenant ERP support portal: client users paste error messages and get a knowledge-base-matched cause/resolution or an auto-escalated ticket, while service staff log in with a separate role to resolve and record cases. The PRD's product_type (web-app) and the chosen JS/TypeScript language family resolve to the recommended default for (web, js): 10x-astro-starter (Astro + React + TypeScript + Supabase + Cloudflare). Supabase supplies Postgres, auth, and storage out of the box, directly matching the two-role login model and the strict per-client data isolation the PRD's Access Control and Guardrails sections require. The starter clears all four agent-friendly quality gates (typed, convention-based, popular in training data, well documented) and carries first-class bootstrapper confidence, so scaffolding is expected to be mostly smooth with occasional manual steps. Auth and AI (knowledge-base matching) feature flags are set; payments, realtime, and background jobs are out of scope per the PRD. Deployment defaults to Cloudflare Pages — the starter's shipped target — with CI on GitHub Actions and auto-deploy on merge to main.
