---
title: RFC: GAP-48--cic-kb - **CIC-KB (open-contradictions - Historical Revocation Authority Split)**
category: research
topic: rfc-gap-48-cic-kb--cic-kb-open-contradictions-hi
gap_id: GAP-48--cic-kb
status: draft
created_at: 2026-09-19T20:28:05.665Z
expansion_method: heuristic
retrieval_mode: hybrid-rrf
ast_grounded_symbols: []
citations: ["wiki/research/historical-revocation-verification.md","trm-research-gaps.md","_kb-sync-staging/trm/current/raw_research_conformance.json"]
sourceRepository: kb-sync
---

# RFC: GAP-48--cic-kb - **CIC-KB (open-contradictions - Historical Revocation Authority Split)**

## 1. Problem Statement & Context
**Historical Revocation Authority Split**: Section 18 of the Sigil protocol specification contains an unresolved contradiction regarding whether the local connector or the central

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **historical-revocation-verification** (`wiki/research/historical-revocation-verification.md`) [hybrid]:
  >
- **1b4861a3-931f-4632-8fc1-343a8dd37df8** (`trm-research-gaps.md`) [hybrid]:
  >
- **raw_research_conformance** (`_kb-sync-staging/trm/current/raw_research_conformance.json`) [lexical_only]:
  >

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
