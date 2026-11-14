---
title: "RFC: GAP-05--ironledger-architecture - **IronLedger Architecture (dynamic-gap-97be5062 - Core architecture)**"
category: "research"
topic: "rfc-gap-05-ironledger-architecture--ironledger-architecture-dynam"
gap_id: "GAP-05--ironledger-architecture"
status: "draft"
created_at: "2026-11-12T11:30:16.669Z"
expansion_method: "heuristic"
retrieval_mode: "hybrid-rrf"
ast_grounded_symbols: []
citations: ["wiki/research/rfc-gap-05-ironledger-architecture--ironledger-architecture-dyn-s.md","wiki/research/rfc-gap-04-ironledger-architecture--ironledger-architecture-open.md","wiki/research/rfc-gap-03-ironledger-architecture--ironledger-architecture-under.md"]
---

# RFC: GAP-05--ironledger-architecture - **IronLedger Architecture (dynamic-gap-97be5062 - Core architecture)**

## 1. Problem Statement & Context
A balanced, immutable double-entry journal running locally on macOS or Ubuntu without Docker dependencies, using PostgreSQL over protected local sockets [1, 2].

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **rfc-gap-05-ironledger-architecture--ironledger-architecture-dyn-s** (`wiki/research/rfc-gap-05-ironledger-architecture--ironledger-architecture-dyn-s.md`) [hybrid]:
  > 
- **rfc-gap-04-ironledger-architecture--ironledger-architecture-open** (`wiki/research/rfc-gap-04-ironledger-architecture--ironledger-architecture-open.md`) [hybrid]:
  > 
- **rfc-gap-03-ironledger-architecture--ironledger-architecture-under** (`wiki/research/rfc-gap-03-ironledger-architecture--ironledger-architecture-under.md`) [vector_only]:
  > --- title: "RFC: GAP-03--ironledger-architecture - **IronLedger Architecture under-sourced - The currently selected source "GitHub - vult-a...**" category: "research" topic: "rfc-gap-03-ironledger-architecture--ironledger-architecture-under" gap_id:

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
