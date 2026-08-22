---
title: "RFC: GAP-04 - Dodge brothers vs Henry Ford governance and profit reinvestment"
category: "research"
topic: "rfc-gap-04-dodge-brothers-vs-henry-ford-g"
gap_id: "GAP-04"
status: "draft"
created_at: "2026-08-22T01:52:02.762Z"
citations: ["docs/kb/notebooklm-sync/architecture.md","docs/kb/notebooklm-sync/pipeline.md","trm-research-gaps.md"]
---

# RFC: GAP-04 - Dodge brothers vs Henry Ford governance and profit reinvestment

## 1. Problem Statement & Context
Analyze legal conflicts and capital expenditure allocation between Ford Motor Company and minority shareholders.)))))))

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base:

- **architecture** (`docs/kb/notebooklm-sync/architecture.md`):
  > ...Architecture  This document describes the architectural layout and component flow for the deterministic synchronization loop between the Rewrite Labs / CIC monorepo and Google NotebookLM.  ## Component Topology  The Ingestion loop connects our filesystem...
- **pipeline** (`docs/kb/notebooklm-sync/pipeline.md`):
  > ...Trigger The process is explicitly initiated by executing: ```bash npm run kb:sync ``` This script calls `scripts/notebooklm/ingest-notebooklm.sh` and does not run in the background unless configured as an...
- **trm-research-gaps** (`trm-research-gaps.md`):
  > ...Standardize backslash stripping and UNC handling across staging tools. Drafted: RFCwiki/research/rfc-gap-02-cross-platform-path-normalizat.md - / GAP-03 Deterministic AST parsing and chunk boundary calculation: Define optimal...

## 3. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 4. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
