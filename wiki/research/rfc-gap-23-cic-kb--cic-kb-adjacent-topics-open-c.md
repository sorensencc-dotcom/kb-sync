---
title: RFC: GAP-23--cic-kb - **CIC-KB (adjacent-topics - Open Chat Widget & Chat SDK (Sigil §19.1 Extensions))**
category: research
topic: rfc-gap-23-cic-kb--cic-kb-adjacent-topics-open-c
gap_id: GAP-23--cic-kb
status: draft
created_at: 2026-09-19T20:27:33.497Z
expansion_method: heuristic
retrieval_mode: hybrid-rrf
ast_grounded_symbols: []
citations: ["_kb-sync-staging/trm/current/raw_research_conformance.json","wiki/research/rfc-gap-02--cic-daily-research-adjacent-t.md","wiki/research/historical-revocation-verification.md"]
sourceRepository: kb-sync
---

# RFC: GAP-23--cic-kb - **CIC-KB (adjacent-topics - Open Chat Widget & Chat SDK (Sigil §19.1 Extensions))**

## 1. Problem Statement & Context
**Open Chat Widget & Chat SDK (Sigil §19.1 Extensions)**: Building a clean-room Vite + React web interface that connects directly to local loopback connector APIs using Server-Sent

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **raw_research_conformance** (`_kb-sync-staging/trm/current/raw_research_conformance.json`) [lexical_only]:
  >
- **rfc-gap-02--cic-daily-research-adjacent-t** (`wiki/research/rfc-gap-02--cic-daily-research-adjacent-t.md`) [vector_only]:
  > --- title: RFC: GAP-02 - **CIC - Daily Research adjacent-topics** category: research topic: rfc-gap-02--cic-daily-research-adjacent-t gap_id: GAP-02 status: draft created_at: 2026-09-05T03:18:17.606Z expansion_method: heuristic retrieval_mode: hybrid
- **historical-revocation-verification** (`wiki/research/historical-revocation-verification.md`) [lexical_only]:
  >

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
