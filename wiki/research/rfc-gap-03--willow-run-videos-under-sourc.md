---
title: RFC: GAP-03 - **Willow Run Videos (under-sourced)**
category: research
topic: rfc-gap-03--willow-run-videos-under-sourc
gap_id: GAP-03
status: draft
created_at: 2026-09-08T00:31:09.744Z
expansion_method: heuristic
retrieval_mode: hybrid-rrf
ast_grounded_symbols: ["scripts/notebooklm/ingest-notebooklm.sh"]
citations: ["wiki/research/rfc-gap-03--willow-run-videos-under-sourc.md","docs/kb/notebooklm-sync/pipeline.md","trm-research-gaps.md"]
sourceRepository: kb-sync
---

# RFC: GAP-03 - **Willow Run Videos (under-sourced)**

## 1. Problem Statement & Context
### **The Boeing B-17 Flying Fortress Production Claim** *   **The Claim:** One highly detailed video transcript asserts that Boeing's **B-17 Flying F))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **rfc-gap-03--willow-run-videos-under-sourc** (`wiki/research/rfc-gap-03--willow-run-videos-under-sourc.md`) [lexical_only]:
  >
- **pipeline** (`docs/kb/notebooklm-sync/pipeline.md`) [vector_only]:
  > --- title: "pipeline" category: "wiki" status: "active" ---  # NotebookLM Sync Pipeline: Ingestion Loop  This document outlines the sequential, deterministic steps performed during the sync execution pipeline.  ## Execution Sequence  The sync pipelin
- **1b4861a3-931f-4632-8fc1-343a8dd37df8** (`trm-research-gaps.md`) [lexical_only]:
  >

### 3. AST Call-Graph & Blast Radius Analysis

Static analysis computed via Graft symbol indexing:

#### Symbol: `scripts/notebooklm/ingest-notebooklm.sh`

* **Callees**: `[graft] tokens saved ≈ 4,878 (99%) — this output ≈ 58 tok vs reading the 1 file(s) it covers whole ≈ 4,936 tok (estimate). At the end of your reply, tell the user the total graft tokens saved this turn — sum each such line across your graft calls — e.g. "🌱 graft saved ~N tokens this turn".`, `calls ← loadModelSelection (scripts/run-closed-loop-research-v2.mjs:L80-L107) [depth 1]`, `calls ← run (scripts/run-closed-loop-research-v2.mjs:L113-L435) [depth 2]`

```text
[graft] tokens saved ≈ 4,878 (99%) — this output ≈ 58 tok vs reading the 1 file(s) it covers whole ≈ 4,936 tok (estimate). At the end of your reply, tell the user the total graft tokens saved this turn — sum each such line across your graft calls — e.g. "🌱 graft saved ~N tokens this turn".

sh · function · scripts/run-closed-loop-research-v2.mjs:L66-L69
  calls ← loadModelSelection (scripts/run-closed-loop-research-v2.mjs:L80-L107) [depth 1]
  calls ← run (scripts/run-closed-loop-research-v2.mj
```

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
