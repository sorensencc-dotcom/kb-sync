---
title: "RFC: GAP-18--willow-run-videos - **Willow Run Videos (follow-up - 4. Ford Purchasing Department Records (Fact-Check the Coffin Scrap Story))**"
category: "research"
topic: "rfc-gap-18-willow-run-videos--willow-run-videos-follow-up-4"
gap_id: "GAP-18--willow-run-videos"
status: "draft"
created_at: "2026-09-19T20:38:37.226Z"
expansion_method: "heuristic"
retrieval_mode: "hybrid-rrf"
ast_grounded_symbols: []
citations: ["trm-research-gaps.md","wiki/research/.catalog.json","docs/kb/notebooklm-sync/error-boundaries.md"]
---

# RFC: GAP-18--willow-run-videos - **Willow Run Videos (follow-up - 4. Ford Purchasing Department Records (Fact-Check the Coffin Scrap Story))**

## 1. Problem Statement & Context
**4. Ford Purchasing Department Records (Fact-Check the Coffin Scrap Story)**

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **1b4861a3-931f-4632-8fc1-343a8dd37df8** (`trm-research-gaps.md`) [hybrid]:
  > 
- **-catalog** (`wiki/research/.catalog.json`) [lexical_only]:
  > 
- **error-boundaries** (`docs/kb/notebooklm-sync/error-boundaries.md`) [vector_only]:
  > --- title: "error boundaries" category: "master-kb" tags: "notebooklm-sync" status: "active" ---  # NotebookLM Sync Pipeline: Error Boundaries  This document defines handling rules and troubleshooting guides for potential failures in the synchronizat

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
