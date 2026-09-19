---
title: "RFC: GAP-79--willow-run-videos - **Willow Run Videos (open-contradictions - Part Counts"
category: "research"
topic: "rfc-gap-79-willow-run-videos--willow-run-videos-open-contra"
gap_id: "GAP-79--willow-run-videos"
status: "draft"
created_at: "2026-09-19T20:41:01.884Z"
expansion_method: "heuristic"
retrieval_mode: "hybrid-rrf"
ast_grounded_symbols: []
citations: ["docs/kb/notebooklm-sync/pipeline.md","wiki/research/.catalog.json","docs/kb/notebooklm-sync/operator-rules.md"]
---

# RFC: GAP-79--willow-run-videos - **Willow Run Videos (open-contradictions - Part Counts

## 1. Problem Statement & Context
)**: **Part Counts:** Transcripts fluctuate between **450,000 parts** [23], **1.225 million parts** [24], **1.25 million parts** [25], and **1.5 million parts** [26, 27].

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **pipeline** (`docs/kb/notebooklm-sync/pipeline.md`) [hybrid]:
  > 
- **-catalog** (`wiki/research/.catalog.json`) [hybrid]:
  > 
- **operator-rules** (`docs/kb/notebooklm-sync/operator-rules.md`) [lexical_only]:
  > 

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
