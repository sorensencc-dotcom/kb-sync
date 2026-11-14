---
title: "RFC: GAP-06--ironledger-architecture - **IronLedger Architecture (dyn-src-e34379a1 - Agent Integration & Security"
category: "research"
topic: "rfc-gap-06-ironledger-architecture--ironledger-architecture-dyn-s"
gap_id: "GAP-06--ironledger-architecture"
status: "draft"
created_at: "2026-11-10T11:02:41.818Z"
expansion_method: "heuristic"
retrieval_mode: "hybrid-rrf"
ast_grounded_symbols: []
citations: ["wiki/concepts/local-context-cache.md","docs/kb/notebooklm-sync/architecture.md","product:helix/README.md"]
---

# RFC: GAP-06--ironledger-architecture - **IronLedger Architecture (dyn-src-e34379a1 - Agent Integration & Security

## 1. Problem Statement & Context
)**: Software agents connect to Vult via the Model Context Protocol (MCP) using `vult mcp` [4]. Agents can query balances, propose transactions, and post journal entries, while human owners retain unilateral control over account approvals, backup recovery keys, period closing, and export operations [4-8].

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **local-context-cache** (`wiki/concepts/local-context-cache.md`) [hybrid]:
  > 
- **architecture** (`docs/kb/notebooklm-sync/architecture.md`) [lexical_only]:
  > 
- **readme** (`product:helix/README.md`) [vector_only]:
  > <!-- title: "Helix" status: active owner: chris last-reviewed: 2026-09-27 brand: helix -->  # Helix  Helix is a local Windows personal-assistant foundation for governed engineering work. It provides a durable local daemon, operator-facing CLI/browser

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
