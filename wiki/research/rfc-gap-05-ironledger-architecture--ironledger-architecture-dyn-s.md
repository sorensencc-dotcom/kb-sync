---
title: "RFC: GAP-05--ironledger-architecture - **IronLedger Architecture (dyn-src-e34379a1 - Architecture & Environment"
category: "research"
topic: "rfc-gap-05-ironledger-architecture--ironledger-architecture-dyn-s"
gap_id: "GAP-05--ironledger-architecture"
status: "draft"
created_at: "2026-11-10T11:02:41.808Z"
expansion_method: "heuristic"
retrieval_mode: "hybrid-rrf"
ast_grounded_symbols: []
citations: ["product:icf/Architecture.md","wiki/research/rfc-gap-01-cic-kb--cic-kb-follow-up-1-software-a.md","product:trm/Home.md"]
---

# RFC: GAP-05--ironledger-architecture - **IronLedger Architecture (dyn-src-e34379a1 - Architecture & Environment

## 1. Problem Statement & Context
)**: Vult is designed as a local-first, double-entry ledger for autonomous software agents [1]. Its architecture pairs a protected background service with an embedded PostgreSQL database over local domain sockets and a local HTTPS browser interface, bypassing containerization dependencies like Docker [1, 2]. It also supports an optional multi-tenant Linux server deployment [1, 3].

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **architecture** (`product:icf/Architecture.md`) [lexical_only]:
  >
- **rfc-gap-01-cic-kb--cic-kb-follow-up-1-software-a** (`wiki/research/rfc-gap-01-cic-kb--cic-kb-follow-up-1-software-a.md`) [vector_only]:
  > --- title: RFC: GAP-01--cic-kb - **CIC-KB follow-up - 1. Software Architecture, Autonomous Agents & Infrastructure** category: research topic: rfc-gap-01-cic-kb--cic-kb-follow-up-1-software-a gap_id: GAP-01--cic-kb status: draft created_at: 2026-09-1
- **home** (`product:trm/Home.md`) [lexical_only]:
  >

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
