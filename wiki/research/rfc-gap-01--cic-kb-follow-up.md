---
title: "RFC: GAP-01 - **CIC-KB (follow-up)**"
category: "research"
topic: "rfc-gap-01--cic-kb-follow-up"
gap_id: "GAP-01"
status: "draft"
created_at: "2026-09-08T00:31:32.613Z"
expansion_method: "heuristic"
retrieval_mode: "hybrid-rrf"
ast_grounded_symbols: ["scripts/notebooklm/ingest-notebooklm.sh"]
citations: ["wiki/research/rfc-gap-01--cic-kb-follow-up.md","trm-research-gaps.md","docs/kb/notebooklm-sync/pipeline.md","wiki/concepts/fail-soft-orchestration.md"]
sourceRepository: "kb-sync"
---

# RFC: GAP-01 - **CIC-KB (follow-up)**

## 1. Problem Statement & Context
To systematically strengthen the architectural foundations, safety boundaries, and performance metrics of the **Cast Iron Charlie (CIC)** master knowledge base and **`kb-sync`**, follow-up work has to replace truncated TRM gap notes with explicit ingest contracts, fail-soft hook behavior, and measurable wiki-health SLOs.

The CIC-KB notebook (`679b8bab-2d87-42cb-a726-6dc54c83acc2`, category `master-kb`) and the `kb-sync` repo are the ingest spine for later documentary research. The original GAP-01 follow-up text was cut mid-token at `` `kb-sy `` and padded with `)`, so this RFC never recorded a complete question. The live gap is three-fold:

1. **Architecture** — `vault_root`, repo `wiki/`, and the Obsidian vault wiki currently share one registry. Duplicate pages (for example `concepts/immutable-staging.md` vs a vault `ImmutableStaging.md`) make autoheal rewrite `[[immutable-staging]]` into an ambiguous comma-joined target.
2. **Safety** — post-commit offline autoheal is fail-soft: a Phase 5 contract miss must not block the commit, but it still leaves yellow hook noise and stale sibling entity pages.
3. **Metrics** — the wiki dashboard only reflects `.validation-report.json`. Scoped `--fix` runs that skip that file look like no-ops after refresh.

## 2. Evidence Grounding & Cache Findings
Related context from the local knowledge base:

- **CIC-KB (follow-up)** (`trm-research-gaps.md`) [lexical]:
  > GAP-01 follow-up for the CIC master knowledge base and `kb-sync`: lock ingest contracts, fail-soft hook behavior, and wiki-health SLOs. Canonical note: [[rfc-gap-01--cic-kb-follow-up]].
- **NotebookLM sync pipeline** (`docs/kb/notebooklm-sync/pipeline.md`) [citation]:
  > Six sequential phases — Trigger, Flatten, Pack, Purge, Upload, Verify. `npm run kb:sync` calls `scripts/notebooklm/ingest-notebooklm.sh` and does not run in the background unless configured as an opt-in Git post-commit hook.
- **Fail-soft orchestration** (`wiki/concepts/fail-soft-orchestration.md`) [citation]:
  > Automated maintenance (autoheal sweepers, background indexing, telemetry) must not block or corrupt primary developer workflows when non-critical anomalies arise, and must fail closed on safety and security boundaries.

## 3. AST Call-Graph & Blast Radius Analysis
Grounded symbol: `scripts/notebooklm/ingest-notebooklm.sh`

`docs/kb/notebooklm-sync/pipeline.md` records this script as the `npm run kb:sync` trigger. It is the flatten / pack / purge / upload / verify entrypoint for NotebookLM ingest. Treat hook-installed copies as opt-in; a failing ingest must stay fail-soft on post-commit.

## 4. Proposed Resolution & Protocol Decision
- Treat `wiki/research/rfc-gap-01--cic-kb-follow-up.md` as the canonical GAP-01 CIC-KB follow-up note. Do not regenerate it from the truncated `))))))))` gap line.
- Keep wiki-link rewrites on a single unique path (`concepts/immutable-staging.md`), never a comma-joined registry array.
- Keep dashboard copy commands writing `.validation-report.json` so operator `--fix` runs change the KPI snapshot.
- Keep post-commit wiki autoheal fail-soft. Surface Phase 5 contract drift as a tracked P2, not a commit blocker.

## 5. Open Questions & Residual Risk
- [ ] How many other `trm-research-gaps.md` rows and RFC problem statements are the same mid-token `)` pad, and should they be rewritten the same way?
- [ ] Should the validator registry prefer repo `wiki/` over the Obsidian vault copy when both contain the same slug?
- [ ] What SLO belongs on the dashboard for a healthy CIC-KB sync (max warning density, max autoheal duration, zero blocking errors)?
