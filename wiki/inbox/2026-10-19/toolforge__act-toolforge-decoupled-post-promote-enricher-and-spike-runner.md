---
source: gemini-spark
skill: daily-ai-news-summary
topic: action-triage
title: "Decoupled Post-Promote Context Enricher & Autonomous Spike Runner"
created: Mon Oct 19 2026 17:15:01 GMT-0400 (Eastern Daylight Time)
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
provenance_type: mobile_inbox_drop
content_sha256: 209d766d767facab8d76758e5c6ba931a16a20b0c9a97e2e1b21d150663fd89a
---

# [ACT-TOOLFORGE-DECOUPLED-POST-PROMOTE-ENRICHER-AND-SPIKE-RUNNER] [EVALUATE] Decoupled Post-Promote Context Enricher & Autonomous Spike Runner

## Context
Promoting action cards to GitHub issues is currently a static passthrough of card text that lacks post-harvest commit overlap detection, live AST touchpoints, and host environment checks. Furthermore, research/feasibility cards (category `EVALUATE` / direction `FEASIBILITY_SPIKE`) lack an end-to-end autonomous closure loop in the ICF dashboard.

## Payload

### Directive & Objective
Implement a decoupled post-promotion context enricher and an autonomous research spike runner that separates deterministic data gathering (graft AST, SQLite RRF, host probes) from bounded local LLM synthesis (`llama3:8b-instruct-fp16` + `cic-jev`), providing rich issue comments and autonomous ticket closure.

### Technical Scope & Architecture
- **Part A: Asynchronous Post-Promote Enricher (`scripts/trm-post-promote-enricher.mjs`):**
  - **Deterministic Grounding Block:** Run `graft skeleton` and `graft callers` for existing files. Run dual-lane RRF search ($k=60$) over `.kb_cache/knowledge.db` (FTS5 BM25 + 384-d dense vectors) to catch overlapping commits and sibling repo implementations (e.g. Issue #179 discovering TRM@4be34e8). Execute non-destructive host telemetry probes (e.g. `127.0.0.1:8765/health`, `tailscale status --json` for Issue #180).
  - **Local LLM Enhancement Block:** Call local Ollama on `:11434` (`llama3:8b-instruct-fp16`) with `cic-jev` scoring to classify tickets into 3 tiers (`LOCAL_COMPLETABLE`, `LOCAL_SCAFFOLD`, `HEAVY_CODING`). For `LOCAL_SCAFFOLD`, draft a narrowed Delta Implementation Plan, CLI contract, and test stub.
  - **Out-of-band Delivery:** Post the generated pre-flight context comment to the GitHub issue via `gh issue comment` and update `.harness/tasks/pending/<action_id>.json` without blocking the HTTP promotion response.
- **Part B: Dedicated "Run Spike" Action Button & Closure Loop:**
  - **Action Card Intake Adapter:** Add `evaluateActionCard` to `modules/trm/gap-triage-engine.mjs` to accept action card objects (`action_id`, target, directive, technical scope, issue number) directly.
  - **UI & Gateway Trigger:** Add a dedicated "🔬 Run Spike" button in `icf/dashboard/index.html` (independent of status select dropdowns) calling a new endpoint `POST /api/reporting/trm-backlog/run-spike` in `icf/src/server.mjs`.
  - **Autonomous Ticket Closure:** Generate `wiki/research/rfc-<action_id>.md`, post the full RFC report as a comment to the GitHub issue, write `receipt-<action_id>-completed.json` to `mobile-outbox` (engaging the ICF re-promotion lock), and transition card status to `DONE`.

### Deliverables & Acceptance Criteria
- [ ] `scripts/trm-post-promote-enricher.mjs` implemented and invoked asynchronously post-promotion.
- [ ] `modules/trm/gap-triage-engine.mjs` extended with `evaluateActionCard` adapter.
- [ ] Dedicated "🔬 Run Spike" action button wired in `icf/dashboard/index.html` and `icf/src/server.mjs`.
- [ ] End-to-end receipt writing and `DONE` status transition tested with mock card payloads.
- [ ] Unit and integration tests passing in `kb-sync` and `icf`.

## Next
Triage into `.harness/tasks/pending/` via `scripts/trm-ingress-watcher.mjs`.
