---
title: "RFC: GAP-09--cic-willys-overland - **CIC - Willys-Overland (dyn-src-eada176a - Supplier Lockout & Reconversion Bottlenecks)**"
category: "research"
topic: "rfc-gap-09-cic-willys-overland--cic-willys-overland-dyn-src-e"
gap_id: "GAP-09--cic-willys-overland"
status: "draft"
created_at: "2026-11-09T12:15:43.747Z"
expansion_method: "heuristic"
retrieval_mode: "hybrid-rrf"
ast_grounded_symbols: []
citations: ["wiki/research/2026-10-12/fifo-week-qa.md","wiki/research/rfc-gap-74-cic-post-war-willys-overland--cic-post-war-willys-overland.md","trm-research-gaps.md"]
---

# RFC: GAP-09--cic-willys-overland - **CIC - Willys-Overland (dyn-src-eada176a - Supplier Lockout & Reconversion Bottlenecks)**

## 1. Problem Statement & Context
Corroborates that Willys-Overland was frozen out of primary component and sheet metal suppliers who prioritized high-volume contracts with the "Big Three" automakers [1, 2]. This supplier lockout left Willys unable to launch conventional passenger cars immediately after World War II, forcing reliance on the CJ-2A platform [1, 4].

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **trm** (`wiki/research/2026-10-12/fifo-week-qa.md`) [lexical_only]:
  >
- **rfc-gap-74-cic-post-war-willys-overland--cic-post-war-willys-overland** (`wiki/research/rfc-gap-74-cic-post-war-willys-overland--cic-post-war-willys-overland.md`) [vector_only]:
  > --- title: RFC: GAP-74--cic-post-war-willys-overland - **CIC - Post-War & Willys-Overland under-sourced - The Claim category: research topic: rfc-gap-74-cic-post-war-willys-overland--cic-post-war-willys-overland gap_id: GAP-74--cic-post-war-willys-ov
- **1b4861a3-931f-4632-8fc1-343a8dd37df8** (`trm-research-gaps.md`) [lexical_only]:
  >

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
