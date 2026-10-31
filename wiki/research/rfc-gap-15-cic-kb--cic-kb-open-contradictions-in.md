---
title: "RFC: GAP-15--cic-kb - **CIC-KB (open-contradictions - Ingest-Time Contradiction Extraction)**"
category: "research"
topic: "rfc-gap-15-cic-kb--cic-kb-open-contradictions-in"
gap_id: "GAP-15--cic-kb"
status: "draft"
created_at: "2026-10-16T12:06:06.948Z"
expansion_method: "heuristic"
retrieval_mode: "hybrid-rrf"
ast_grounded_symbols: []
citations: ["product:trm/2026-08-08-video-time-range-keyword-filter.md","wiki/research/rfc-gap-48-cic-kb--cic-kb-open-contradictions-hi.md","product:trm/superpowers/plans/2026-08-08-video-time-range-keyword-filter.md"]
---

# RFC: GAP-15--cic-kb - **CIC-KB (open-contradictions - Ingest-Time Contradiction Extraction)**

## 1. Problem Statement & Context
**Ingest-Time Contradiction Extraction**: Tooling specifications such as `llm_wiki` include a two-step chain-of-thought ingest pipeline where the analysis phase specifically checks

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **2026-08-08-video-time-range-keyword-filter** (`product:trm/2026-08-08-video-time-range-keyword-filter.md`) [lexical_only]:
  > 
- **rfc-gap-48-cic-kb--cic-kb-open-contradictions-hi** (`wiki/research/rfc-gap-48-cic-kb--cic-kb-open-contradictions-hi.md`) [vector_only]:
  > --- title: RFC: GAP-48--cic-kb - **CIC-KB open-contradictions - Historical Revocation Authority Split** category: research topic: rfc-gap-48-cic-kb--cic-kb-open-contradictions-hi gap_id: GAP-48--cic-kb status: draft created_at: 2026-09-19T20:28:05.66
- **2026-08-08-video-time-range-keyword-filter** (`product:trm/superpowers/plans/2026-08-08-video-time-range-keyword-filter.md`) [lexical_only]:
  > 

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
