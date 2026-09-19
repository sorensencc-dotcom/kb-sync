---
title: "RFC: GAP-99--cic-cuban-seizures-retired-assets - **CIC - Cuban Seizures & Retired Assets (under-sourced - Intercontinental Hotels Corporation (Claim CU-2521)"
category: "research"
topic: "rfc-gap-99-cic-cuban-seizures-retired-assets--cic-cuban-seizures-retired-as"
gap_id: "GAP-99--cic-cuban-seizures-retired-assets"
status: "draft"
created_at: "2026-09-19T21:03:01.516Z"
expansion_method: "heuristic"
retrieval_mode: "hybrid-rrf"
ast_grounded_symbols: []
citations: ["wiki/research/rfc-gap-02--cic-cuban-seizures-retired-as.md","wiki/research/rfc-gap-07-cic-kb--cic-kb-follow-up-fcsc-cuban-c.md","docs/kb/notebooklm-sync/architecture.md"]
---

# RFC: GAP-99--cic-cuban-seizures-retired-assets - **CIC - Cuban Seizures & Retired Assets (under-sourced - Intercontinental Hotels Corporation (Claim CU-2521)

## 1. Problem Statement & Context
)**: **Intercontinental Hotels Corporation (Claim CU-2521):** IHC claimed **\$3,138,192.00** for lost management fees based on 25% net operating income [29]. The FCSC denied this as pro

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **rfc-gap-02--cic-cuban-seizures-retired-as** (`wiki/research/rfc-gap-02--cic-cuban-seizures-retired-as.md`) [hybrid]:
  > 
- **rfc-gap-07-cic-kb--cic-kb-follow-up-fcsc-cuban-c** (`wiki/research/rfc-gap-07-cic-kb--cic-kb-follow-up-fcsc-cuban-c.md`) [lexical_only]:
  > 
- **architecture** (`docs/kb/notebooklm-sync/architecture.md`) [vector_only]:
  > --- title: "architecture" category: "master-kb" tags: "notebooklm-sync" status: "active" ---  # NotebookLM Sync Pipeline: Architecture  This document describes the architectural layout and component flow for the deterministic synchronization loop bet

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
