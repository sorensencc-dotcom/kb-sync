---
title: RFC: GAP-67--cic-reddit - **CIC-Reddit (open-contradictions - Autocratic Labor Suppression
category: research
topic: rfc-gap-67-cic-reddit--cic-reddit-open-contradiction
gap_id: GAP-67--cic-reddit
status: draft
created_at: 2026-09-19T21:27:08.993Z
expansion_method: heuristic
retrieval_mode: hybrid-rrf
ast_grounded_symbols: ["scripts/notebooklm/ingest-notebooklm.sh"]
citations: ["wiki/research/rfc-gap-05-harry-bennett-service-departme.md","wiki/research/rfc-gap-26-cic-ford-executive-dynamics-politics--cic-ford-executive-dynamics-p.md","wiki/research/rfc-gap-04-dodge-brothers-vs-henry-ford-g.md"]
sourceRepository: kb-sync
---

# RFC: GAP-67--cic-reddit - **CIC-Reddit (open-contradictions - Autocratic Labor Suppression

## 1. Problem Statement & Context
)**: **Autocratic Labor Suppression:** To block unionization, Ford relied on Harry Bennett and the company's internal "Service Department"—a private army of ex-cons and boxers who viole

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via hybrid-rrf search:

- **rfc-gap-05-harry-bennett-service-departme** (`wiki/research/rfc-gap-05-harry-bennett-service-departme.md`) [hybrid]:
  >
- **rfc-gap-26-cic-ford-executive-dynamics-politics--cic-ford-executive-dynamics-p** (`wiki/research/rfc-gap-26-cic-ford-executive-dynamics-politics--cic-ford-executive-dynamics-p.md`) [lexical_only]:
  >
- **rfc-gap-04-dodge-brothers-vs-henry-ford-g** (`wiki/research/rfc-gap-04-dodge-brothers-vs-henry-ford-g.md`) [vector_only]:
  > --- title: "RFC: GAP-04 - Dodge brothers vs Henry Ford governance and profit reinvestment" category: "research" topic: "rfc-gap-04-dodge-brothers-vs-henry-ford-g" gap_id: "GAP-04" status: "draft" created_at: "2026-08-23T01:58:16.715Z" citations: "doc

### 3. AST Call-Graph & Blast Radius Analysis

Static analysis computed via Graft symbol indexing:

#### Symbol: `scripts/notebooklm/ingest-notebooklm.sh`

* **Callees**: `[graft] tokens saved ≈ 5,412 (98%) — this output ≈ 83 tok vs reading the 1 file(s) it covers whole ≈ 5,495 tok (estimate). At the end of your reply, tell the user the total graft tokens saved this turn — sum each such line across your graft calls — e.g. "🌱 graft saved ~N tokens this turn".`, `calls ← loadModelSelection (scripts/run-closed-loop-research-v2.mjs:L82-L109) [depth 1]`, `calls ← run (scripts/run-closed-loop-research-v2.mjs:L115-L488) [depth 1]`, `calls ← run-closed-loop-research-v2.mjs (scripts/run-closed-loop-research-v2.mjs:L1-L494) [depth 2]`

```text
[graft] tokens saved ≈ 5,412 (98%) — this output ≈ 83 tok vs reading the 1 file(s) it covers whole ≈ 5,495 tok (estimate). At the end of your reply, tell the user the total graft tokens saved this turn — sum each such line across your graft calls — e.g. "🌱 graft saved ~N tokens this turn".

sh · function · scripts/run-closed-loop-research-v2.mjs:L68-L71
  calls ← loadModelSelection (scripts/run-closed-loop-research-v2.mjs:L82-L109) [depth 1]
  calls ← run (scripts/run-closed-loop-research-v2.mj
```

## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
