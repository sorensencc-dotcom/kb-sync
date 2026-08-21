---
title: "RFC: GAP-03 - Deterministic AST parsing and chunk boundary calculation"
category: "research"
topic: "rfc-gap-03-deterministic-ast-parsing-and"
gap_id: "GAP-03"
status: "draft"
created_at: "2026-08-21T21:46:02.963Z"
citations: ["docs/kb/notebooklm-sync/pipeline.md","docs/kb/notebooklm-sync/architecture.md","docs/kb/notebooklm-sync/error-boundaries.md"]
---

# RFC: GAP-03 - Deterministic AST parsing and chunk boundary calculation

## 1. Problem Statement & Context
Define optimal token chunk sizing for NotebookLM pack consolidation.

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base:

- **pipeline** (`docs/kb/notebooklm-sync/pipeline.md`):
  > ...repository, [MATCH]parse[/MATCH] the [MATCH]AST[/MATCH]/text structure, [MATCH]and[/MATCH] apply exclusions [MATCH]defined[/MATCH] in `pyragify.yaml`.  ### 3. [MATCH]Pack[/MATCH] The script compiles the extracted codebase files into a single [MATCH]consolidated[/MATCH] file `repo_knowledge_[MATCH]pack[/MATCH].txt` inside...
- **architecture** (`docs/kb/notebooklm-sync/architecture.md`):
  > ...filters, [MATCH]chunks[/MATCH], [MATCH]and[/MATCH] processes files according to exclusion rules. 3. **Combined [MATCH]Pack[/MATCH] (`repo_knowledge_[MATCH]pack[/MATCH].txt`)**: A single [MATCH]consolidated[/MATCH] text file containing all codebases with file delimiters. This avoids [MATCH]NotebookLM[/MATCH]'s 50...
- **error-boundaries** (`docs/kb/notebooklm-sync/error-boundaries.md`):
  > --- title: "error [MATCH]boundaries[/MATCH]" category: "wiki" status: "active" ---  # [MATCH]NotebookLM[/MATCH] Sync Pipeline: Error [MATCH]Boundaries[/MATCH]  This document [MATCH]defines[/MATCH] handling rules [MATCH]and[/MATCH] troubleshooting guides [MATCH]for[/MATCH] potential failures in the synchronization loop.  ## Failure Scenarios & Mitigations  ### 1. Missing...

## 3. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 4. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
