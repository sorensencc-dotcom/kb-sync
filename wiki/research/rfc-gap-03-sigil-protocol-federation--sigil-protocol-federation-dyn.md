---
title: "RFC: GAP-03--sigil-protocol-federation - **Sigil Protocol & Federation (dynamic-gap-c75fdaa1 - Hermes & Discord)**"
category: "research"
topic: "rfc-gap-03-sigil-protocol-federation--sigil-protocol-federation-dyn"
gap_id: "GAP-03--sigil-protocol-federation"
status: "draft"
created_at: "2026-11-13T11:46:43.263Z"
expansion_method: "heuristic"
retrieval_mode: "hybrid-rrf"
ast_grounded_symbols: []
citations: ["wiki/research/trm-drive-transport-adapter-spec.md","wiki/research/rfc-gap-03-sigil-protocol-federation--sigil-protocol-federation-adj.md","product:trm/2026-08-05-triage-intake-pdf-docx-epub-design.md"]
---

# RFC: GAP-03--sigil-protocol-federation - **Sigil Protocol & Federation (dynamic-gap-c75fdaa1 - Hermes & Discord)**

## 1. Problem Statement & Context
Unmanaged agent-to-agent communication in free-response Discord channels resulted in infinite acknowledgment loops where human "stop" commands were ignored [4]. Upstream Hermes introduced "Bot Mode" with hard caps (3 rounds and 10 messages per user prompt) to prevent runaway conversations, while Claude's Discord plugin drops bot-authored messages entirely by default [2, 4].

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **trm-drive-transport-adapter-spec** (`wiki/research/trm-drive-transport-adapter-spec.md`) [lexical_only]:
  > 
- **rfc-gap-03-sigil-protocol-federation--sigil-protocol-federation-adj** (`wiki/research/rfc-gap-03-sigil-protocol-federation--sigil-protocol-federation-adj.md`) [vector_only]:
  > --- title: "RFC: GAP-03--sigil-protocol-federation - **Sigil Protocol & Federation adjacent-topics - Communication protocols and orchestration**" category: "research" topic: "rfc-gap-03-sigil-protocol-federation--sigil-protocol-federation-adj" gap_id
- **2026-08-05-triage-intake-pdf-docx-epub-design** (`product:trm/2026-08-05-triage-intake-pdf-docx-epub-design.md`) [lexical_only]:
  > 

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
