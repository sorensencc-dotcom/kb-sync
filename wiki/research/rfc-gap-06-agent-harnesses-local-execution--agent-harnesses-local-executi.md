---
title: "RFC: GAP-06--agent-harnesses-local-execution - **Agent Harnesses & Local Execution (Graft, SAM, Herdr) (dynamic-gap-18c37e99 - Herdr)**"
category: "research"
topic: "rfc-gap-06-agent-harnesses-local-execution--agent-harnesses-local-executi"
gap_id: "GAP-06--agent-harnesses-local-execution"
status: "draft"
created_at: "2026-11-13T11:33:08.553Z"
expansion_method: "heuristic"
retrieval_mode: "hybrid-rrf"
ast_grounded_symbols: []
citations: ["wiki/research/rfc-gap-03-agent-harnesses-local-execution--agent-harnesses-local-executi.md","wiki/research/rfc-gap-05-agent-harnesses-local-execution--agent-harnesses-local-executi.md","wiki/research/rfc-gap-06-agent-harnesses-local-execution--agent-harnesses-local-executi.md"]
---

# RFC: GAP-06--agent-harnesses-local-execution - **Agent Harnesses & Local Execution (Graft, SAM, Herdr) (dynamic-gap-18c37e99 - Herdr)**

## 1. Problem Statement & Context
Serves as the **terminal multiplexer / PTY management layer** for terminal-centric agent orchestration, process lifecycle monitoring, and low-level CLI execution [4, 6].

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **rfc-gap-03-agent-harnesses-local-execution--agent-harnesses-local-executi** (`wiki/research/rfc-gap-03-agent-harnesses-local-execution--agent-harnesses-local-executi.md`) [hybrid]:
  >
- **rfc-gap-05-agent-harnesses-local-execution--agent-harnesses-local-executi** (`wiki/research/rfc-gap-05-agent-harnesses-local-execution--agent-harnesses-local-executi.md`) [hybrid]:
  >
- **rfc-gap-06-agent-harnesses-local-execution--agent-harnesses-local-executi** (`wiki/research/rfc-gap-06-agent-harnesses-local-execution--agent-harnesses-local-executi.md`) [lexical_only]:
  >

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
