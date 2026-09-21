---
title: RFC: GAP-22--cic-kb - **CIC-KB (open-contradictions - Chat Surface Injection Hook Absence)**
category: research
topic: rfc-gap-22-cic-kb--cic-kb-open-contradictions-ch
gap_id: GAP-22--cic-kb
status: draft
created_at: 2026-09-19T20:32:58.445Z
expansion_method: heuristic
retrieval_mode: hybrid-rrf
ast_grounded_symbols: []
citations: ["docs/kb/notebooklm-sync/architecture.md","wiki/research/rfc-gap-02--cic-kb-open-contradictions.md","docs/kb/notebooklm-sync/operator-rules.md"]
sourceRepository: kb-sync
---

# RFC: GAP-22--cic-kb - **CIC-KB (open-contradictions - Chat Surface Injection Hook Absence)**

## 1. Problem Statement & Context
**Chat Surface Injection Hook Absence**: Sending a message via Sigil does not insert turns directly into active Claude Desktop or Codex CLI chat surfaces, requiring manual terminal

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **architecture** (`docs/kb/notebooklm-sync/architecture.md`) [lexical_only]:
  >
- **rfc-gap-02--cic-kb-open-contradictions** (`wiki/research/rfc-gap-02--cic-kb-open-contradictions.md`) [vector_only]:
  > --- title: RFC: GAP-02 - **CIC-KB open-contradictions** category: research topic: rfc-gap-02--cic-kb-open-contradictions gap_id: GAP-02 status: draft created_at: 2026-09-05T03:18:22.054Z expansion_method: heuristic retrieval_mode: hybrid-rrf ast_grou
- **operator-rules** (`docs/kb/notebooklm-sync/operator-rules.md`) [lexical_only]:
  >

### 3. AST Call-Graph & Blast Radius Analysis
*No static call-graph symbols detected in target codebase for this item.*

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
