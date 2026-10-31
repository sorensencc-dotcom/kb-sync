---
source: gemini-spark
skill: daily-ai-news-summary
topic: action-triage
title: "Fix ICF Backlog Target Repository Routing Map"
created: Mon Oct 19 2026 17:15:00 GMT-0400 (Eastern Daylight Time)
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
provenance_type: mobile_inbox_drop
content_sha256: 47a683d6d65a1d8b98844d0159fc4c7e8f33fb1f46e535e6744dd46a1a0bb47e
---

# [ACT-ICF-FIX-BACKLOG-TARGET-ROUTING-MAP] [IMPLEMENT] Fix ICF Backlog Target Repository Routing Map

## Context
When action cards are promoted in the ICF TRM Action Backlog Panel (http://127.0.0.1:3000), target repositories frequently default to `sorensencc-dotcom/toolforge` even when the card payload specifies a different target repository (such as `kb-sync`, `personal-os`, `rewrite-mcp`, or `IronLedger`). This occurred on Issue #179 (target kb-sync) and Issue #180 (target personal-os) due to a hardcoded `BACKLOG_DOMAIN_TO_REPO` dictionary in `icf/dashboard/index.html` and a fallback in `icf/src/server.mjs`.

## Payload

### Directive & Objective
Harmonize the target repository resolution across `icf/dashboard/index.html` and `icf/src/server.mjs` with the canonical mapping established in `scripts/trm-promote-card.mjs` to ensure promoted GitHub issues route to their correct repositories deterministically.

### Technical Scope & Architecture
- **Dashboard Mapping Update (`icf/dashboard/index.html`):** Update `BACKLOG_DOMAIN_TO_REPO` to explicitly map:
  - `kb-sync` -> `sorensencc-dotcom/kb-sync`
  - `personal-os` -> `sorensencc-dotcom/personal-os`
  - `rewrite-mcp` -> `sorensencc-dotcom/rewrite-mcp`
  - `ironledger` -> `sorensencc-dotcom/IronLedger`
  - `sigil` -> `sorensencc-dotcom/sigil`
  - `toolforge` -> `sorensencc-dotcom/toolforge`
- **Gateway Server Resolution (`icf/src/server.mjs`):** In `createGatewayServer` `/api/reporting/trm-backlog/promote`, replace static fallback with canonical target repository resolution matching the updated mapping.
- **Test Invariants:** Add unit and integration assertions in `icf/test/trm-backlog-api.test.mjs` verifying target repository resolution for `kb-sync`, `personal-os`, `rewrite-mcp`, and `ironledger`.

### Deliverables & Acceptance Criteria
- [ ] `BACKLOG_DOMAIN_TO_REPO` in `icf/dashboard/index.html` updated with canonical mappings.
- [ ] `icf/src/server.mjs` promotion handler resolves target repo deterministically from card domain/target.
- [ ] Automated tests in `icf/test/trm-backlog-api.test.mjs` pass cleanly (`npm test` in `c:/dev/icf`).
- [ ] No regression on Warm Parchment theme or ICF dashboard rendering.

## Next
Triage into `.harness/tasks/pending/` via `scripts/trm-ingress-watcher.mjs`.
