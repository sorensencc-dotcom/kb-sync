---
title: "RFC: GAP-03 - Deterministic AST parsing and chunk boundary calculation"
category: "research"
topic: "rfc-gap-03-deterministic-ast-parsing-and"
gap_id: "GAP-03"
status: "draft"
created_at: "2026-08-23T01:58:16.713Z"
citations: ["wiki/research/rfc-gap-03-deterministic-ast-parsing-and.md","trm-research-gaps.md","docs/kb/notebooklm-sync/pipeline.md"]
---

# RFC: GAP-03 - Deterministic AST parsing and chunk boundary calculation

## 1. Problem Statement & Context
Define optimal token chunk sizing for NotebookLM pack consolidation.)))))))))))))))))))))))))))))))

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base:

- **rfc-gap-03-deterministic-ast-parsing-and** (`wiki/research/rfc-gap-03-deterministic-ast-parsing-and.md`):
  > ...GAP-03 - Deterministic AST parsing and chunk boundary calculation  ## 1. Problem Statement & Context Define optimal token chunk sizing for NotebookLM pack consolidation.  ## 2. Evidence Grounding & Cache Findings The following related context nodes...
- **trm-research-gaps** (`trm-research-gaps.md`):
  > ...normalizat.md - / GAP-03 Deterministic AST parsing and chunk boundary calculation: Define optimal token chunk sizing for NotebookLM pack consolidation. Drafted: RFCwiki/research/rfc-gap-03-deterministic-ast-parsing-and.md
- **pipeline** (`docs/kb/notebooklm-sync/pipeline.md`):
  > ...repository, parse the AST/text structure, and apply exclusions defined in `pyragify.yaml`.  ### 3. Pack The script compiles the extracted codebase files into a single consolidated file `repo_knowledge_pack.txt` inside...

## 3. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 4. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
