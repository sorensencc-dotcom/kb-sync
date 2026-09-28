---
title: RFC: GAP-11--willow-run-videos - **Willow Run Videos (follow-up - Target Collection
category: research
topic: rfc-gap-11-willow-run-videos--willow-run-videos-follow-up-t
gap_id: GAP-11--willow-run-videos
status: draft
created_at: 2026-09-23T12:12:28.414Z
expansion_method: heuristic
retrieval_mode: hybrid-rrf
ast_grounded_symbols: ["consolidate-pack.mjs"]
citations: ["wiki/research/rfc-gap-14-willow-run-videos--willow-run-videos-follow-up-t.md","wiki/research/rfc-gap-03.md","trm-research-gaps.md"]
sourceRepository: kb-sync
---

# RFC: GAP-11--willow-run-videos - **Willow Run Videos (follow-up - Target Collection

## 1. Problem Statement & Context
)**: **Target Collection:** Clara Ford Papers & Diaries (1941) at the **Benson Ford Research Center** [16, 18-21].

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **rfc-gap-14-willow-run-videos--willow-run-videos-follow-up-t** (`wiki/research/rfc-gap-14-willow-run-videos--willow-run-videos-follow-up-t.md`) [hybrid]:
  >
- **rfc-gap-03** (`wiki/research/rfc-gap-03.md`) [lexical_only]:
  >
- **1b4861a3-931f-4632-8fc1-343a8dd37df8** (`trm-research-gaps.md`) [vector_only]:
  > --- source_title: "Mined Research Gaps and Topics Registry" repository: "CIC Research Protocols - Accession 101, Box 4" document_date: "2026-09-19" verification_status: "verified" category: daily notebook_id: 1b4861a3-931f-4632-8fc1-343a8dd37df8 stat

### 3. AST Call-Graph & Blast Radius Analysis

Static analysis computed via Graft symbol indexing:

#### Symbol: `consolidate-pack.mjs`

* **Callees**: `[graft] tokens saved ≈ 5,954 (97%) — this output ≈ 173 tok vs reading the 6 file(s) it covers whole ≈ 6,127 tok (estimate). At the end of your reply, tell the user the total graft tokens saved this turn — sum each such line across your graft calls — e.g. "🌱 graft saved ~N tokens this turn".`, `calls ← dispatchMultiNotebook (scripts/notebooklm/dispatch-multi-notebook.mjs:L28-L79) [depth 1]`

```text
[graft] tokens saved ≈ 5,954 (97%) — this output ≈ 173 tok vs reading the 6 file(s) it covers whole ≈ 6,127 tok (estimate). At the end of your reply, tell the user the total graft tokens saved this turn — sum each such line across your graft calls — e.g. "🌱 graft saved ~N tokens this turn".

consolidate-pack.mjs · file · scripts/consolidate-pack.mjs:L1-L344
  imports ← dispatch-multi-notebook.mjs (scripts/notebooklm/dispatch-multi-notebook.mjs:L1-L90) [depth 1]
  imports ← consolidate-pack-budg
```

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
