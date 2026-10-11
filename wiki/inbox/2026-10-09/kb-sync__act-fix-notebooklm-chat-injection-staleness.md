---
source: gemini-spark
skill: operational-ideas-harvest
topic: action-triage
title: "Fix NotebookLM Chat Injection Pipeline Stagnation and Cluster Registry Parity"
created: Thu Oct 08 2026 20:58:00 GMT-0400 (Eastern Daylight Time)
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
provenance_type: mobile_inbox_drop
content_sha256: 3637845ecb11440e01092a5f83bf44858b73c22bd9aac285e3626ff0745db245
---

# Fix NotebookLM Chat Injection Pipeline Stagnation and Cluster Registry Parity

## Context
A live audit of the 21-notebook knowledge plane across Google Drive and NotebookLM identified a systemic stall in the automated chat injection daemon (C:\dev\kb-sync):

1. Cluster Registry Omission: 9 out of 21 canonical notebooks are completely omitted from the injection loop. The 7 Canonical KB packs (KB - Governance, KB - Modules, KB - Skills, KB - Operations, KB - Meta, KB - Targets, KB - Superpowers), Personal OS, and Open Dev Issues have had 0 chat injections and 0 daily synthesis logs since initialization (over 22 days of dormancy).
2. Batch Catch-Up Latency: Prior to 2026-10-08, only Rewrite Labs and Agent Harnesses were executing daily. 15 notebooks sat without logs for weeks until a single sequential catch-up burst ran between 11:49 UTC and 14:11 UTC today.
3. Boilerplate Question Stagnation: Dynamic question generation failed across the board. The daemon fell back to injecting an identical generic 4-question template ("What open questions or unresolved contradictions exist...", "What claims are asserted but single-sourced...", "What adjacent topics...", "What follow-up research...") into nearly every notebook instead of domain-specific gap items (GAP-XX), new source diffs, or commit deltas.

## Pre-Flight Verification
* Outbox Receipts: Checked TRM-Research/mobile-outbox. Receipt 1b774cb4 addressed transport resilience and auth keep-alive, but did NOT update the target registry list or dynamic question injection logic.
* Drive Mirror: Checked My Drive/notebooklm/. Dedicated sync folders do not exist for the 7 KB packs or Personal OS.
* Open Dev Issues: No ticket currently tracks target directory parity for kb-sync chat injection.

## Payload

### Directive & Objective
Refactor the local chat injection runner in C:\dev\kb-sync (e.g. scripts/notebooklm/ / trm-ingest-drive.mjs) to strictly enforce:

1. Canonical 21-notebook target registry parity (including all 7 KB packs, Personal OS, and Open Dev Issues).
2. Automatic folder provisioning in Google Drive (My Drive/notebooklm/<slug>/).
3. Dynamic, domain-specific question synthesis from active gap registries (inbox-mobile-staging.md, cic-qa-master-inventory-*.md) and source diffs, prohibiting repeated identical 4-question fallback loops.
4. Deterministic fail-closed audit telemetry that raises an alert if any notebook exceeds 24-hour injection latency.

### Direction & Triage Rationale
* Direction: REFACTOR_OPTIMIZATION / IMPLEMENT. The underlying NotebookLM auth and execution harness exist, but the target registry is hardcoded to an incomplete legacy subset, and prompt generation lacks dynamic entropy.
* Triage Score: Impact 5/5, Effort 2/5, Confidence 5/5 (Composite ROI: 9.0/10). Critical operational blindspot causing unmonitored knowledge staleness.

### Technical Scope & Architecture
1. Target Directory Registry (configs/notebooklm.yaml):
   * Align target notebook UUID list exactly with Ecosystem Architecture Guide (Current).md:
      * 8 Historical (6fd7c40b, 0caf6707, 9c469910, c8360946, 64949154, 70be0df3, 679b8bab, 1b4861a3)
      * 12 Core Software / Dev (76e1932c, 26eacb85, 359b346c, 140119ae, cb0498ce, b42534be, 096b5b92, 3ac216cc, 1ab8f1a2, 30f80cc0, 0cab9d12, 95867d03)
      * 1 Personal OS (9724e682)
      * Operational buffers: 52332bef (Grok Bot), bec5a197 (AI News), 39a71593 (AI-Ideas)
2. Dynamic Question Resolver:
   * For historical packs: Query active GAP-XX items and unresolved contradictions from matrix.
   * For dev/architecture packs: Query recent commits and PRs from the last 24h.
   * For operational/KB packs: Query tooling bottlenecks and compliance invariant rules.
   * Implement hash check: If proposed question battery is identical to prior day's battery for that notebook, reject and generate contextual questions from newest source chunk.
3. Execution Loop & Pacing:
   * Implement distributed execution pacing (minimum 3.5s per turn) to avoid NotebookLM status 3 / 429 rate limits.
   * Add automated Drive sync folder creation if notebooklm/<slug> does not exist.

### Deliverables & Acceptance Criteria
* configs/notebooklm.yaml contains all 21 canonical notebooks + 3 operational buffers.
* Test run verifies chat injection succeeds on KB - Governance and Personal OS.
* No notebook receives the static generic 4-question fallback battery.
* Daily synthesis logs successfully mirror to My Drive/notebooklm/<notebook-slug>/.

## Next
Triage into active git backlog via node scripts/trm-ingest-drive.mjs in C:\dev\kb-sync.
