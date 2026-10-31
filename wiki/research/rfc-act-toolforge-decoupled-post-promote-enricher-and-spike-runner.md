---
title: "RFC: ACT-TOOLFORGE-DECOUPLED-POST-PROMOTE-ENRICHER-AND-SPIKE-RUNNER - Decoupled Post-Promote Context Enricher & Autonomous Spike Runner"
category: "research"
topic: "rfc-act-toolforge-decoupled-post-promote-enricher-and-spike-runner-decoupled-post-promote-context"
gap_id: "ACT-TOOLFORGE-DECOUPLED-POST-PROMOTE-ENRICHER-AND-SPIKE-RUNNER"
status: "draft"
created_at: "2026-10-19T22:59:04.142Z"
expansion_method: "raw"
retrieval_mode: "hybrid-rrf"
ast_grounded_symbols: []
citations: ["wiki/research/rfc-gap-05-harry-bennett-service-departme.md","docs/kb/notebooklm-sync/architecture.md","wiki/research/rfc-gap-04-dodge-brothers-vs-henry-ford-g.md","wiki/research/rfc-gap-32-cic-research-deltas-living-matrix--cic-research-deltas-living-ma.md","wiki/research/rfc-gap-06-willow-run-b-24-knock-down-kit.md"]
---

# RFC: ACT-TOOLFORGE-DECOUPLED-POST-PROMOTE-ENRICHER-AND-SPIKE-RUNNER - Decoupled Post-Promote Context Enricher & Autonomous Spike Runner

## 1. Problem Statement & Context
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
  - **Acti

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **rfc-gap-05-harry-bennett-service-departme** (`wiki/research/rfc-gap-05-harry-bennett-service-departme.md`) [vector_only]:
  > --- title: "RFC: GAP-05 - Harry Bennett Service Department authority and plant oversight" category: "research" topic: "rfc-gap-05-harry-bennett-service-departme" gap_id: "GAP-05" status: "draft" created_at: "2026-08-23T01:58:16.717Z" citations: "docs
- **architecture** (`docs/kb/notebooklm-sync/architecture.md`) [vector_only]:
  > --- title: "architecture" category: "master-kb" tags: "notebooklm-sync" status: "active" ---  # NotebookLM Sync Pipeline: Architecture  This document describes the architectural layout and component flow for the deterministic synchronization loop bet
- **rfc-gap-04-dodge-brothers-vs-henry-ford-g** (`wiki/research/rfc-gap-04-dodge-brothers-vs-henry-ford-g.md`) [vector_only]:
  > --- title: "RFC: GAP-04 - Dodge brothers vs Henry Ford governance and profit reinvestment" category: "research" topic: "rfc-gap-04-dodge-brothers-vs-henry-ford-g" gap_id: "GAP-04" status: "draft" created_at: "2026-08-23T01:58:16.715Z" citations: "doc
- **rfc-gap-32-cic-research-deltas-living-matrix--cic-research-deltas-living-ma** (`wiki/research/rfc-gap-32-cic-research-deltas-living-matrix--cic-research-deltas-living-ma.md`) [vector_only]:
  > --- title: "RFC: GAP-32--cic-research-deltas-living-matrix - **CIC - Research Deltas & Living Matrix adjacent-topics - The Topic" category: "research" topic: "rfc-gap-32-cic-research-deltas-living-matrix--cic-research-deltas-living-ma" gap_id: "GAP-3
- **rfc-gap-06-willow-run-b-24-knock-down-kit** (`wiki/research/rfc-gap-06-willow-run-b-24-knock-down-kit.md`) [vector_only]:
  > --- title: "RFC: GAP-06 - Willow Run B-24 knock-down kit manufacturing and logistics" category: "research" topic: "rfc-gap-06-willow-run-b-24-knock-down-kit" gap_id: "GAP-06" status: "draft" created_at: "2026-08-23T01:58:16.720Z" citations: "wiki/res

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
