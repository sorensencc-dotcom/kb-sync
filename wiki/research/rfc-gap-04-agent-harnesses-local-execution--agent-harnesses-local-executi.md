---
title: "RFC: GAP-04--agent-harnesses-local-execution - **Agent Harnesses & Local Execution (Graft, SAM, Herdr) (dynamic-gap-03288c0f - 1.)**"
category: "research"
topic: "rfc-gap-04-agent-harnesses-local-execution--agent-harnesses-local-executi"
gap_id: "GAP-04--agent-harnesses-local-execution"
status: "draft"
created_at: "2026-11-13T11:33:08.553Z"
expansion_method: "heuristic"
retrieval_mode: "hybrid-rrf"
ast_grounded_symbols: []
citations: ["wiki/research/rfc-gap-03-agent-harnesses-local-execution--agent-harnesses-local-executi.md","wiki/research/rfc-gap-06-agent-harnesses-local-execution--agent-harnesses-local-executi.md","wiki/research/rfc-gap-05-agent-harnesses-local-execution--agent-harnesses-local-executi.md"]
---

# RFC: GAP-04--agent-harnesses-local-execution - **Agent Harnesses & Local Execution (Graft, SAM, Herdr) (dynamic-gap-03288c0f - 1.)**

## 1. Problem Statement & Context
1. Core Architectural Role & Context **Herdr** serves as the **terminal multiplexer** within the local execution tier, responsible for providing **terminal-centric process execution and interactive session control** [1, 2].

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **rfc-gap-03-agent-harnesses-local-execution--agent-harnesses-local-executi** (`wiki/research/rfc-gap-03-agent-harnesses-local-execution--agent-harnesses-local-executi.md`) [hybrid]:
  >
- **rfc-gap-06-agent-harnesses-local-execution--agent-harnesses-local-executi** (`wiki/research/rfc-gap-06-agent-harnesses-local-execution--agent-harnesses-local-executi.md`) [hybrid]:
  >
- **rfc-gap-05-agent-harnesses-local-execution--agent-harnesses-local-executi** (`wiki/research/rfc-gap-05-agent-harnesses-local-execution--agent-harnesses-local-executi.md`) [hybrid]:
  >

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
