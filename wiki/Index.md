# Knowledge Base Index

**Last Updated:** 2026-08-03 19:50 UTC  
**Pack Hash:** (from 20260803-195000 staging)  
**Total Entities:** 14  
**Total Concepts:** 4  

---

## Entities

### Core Scripts & Orchestration

- [[run-all.sh]] — Master orchestrator for multi-target KB sync pipeline (fail-soft orchestration)
- [[flatten.sh]] — Generates file manifests and concatenates sources into knowledge packs
- [[chunk.sh]] — Size-bounded chunking utility splitting large packs at heading boundaries
- [[rollback.sh]] — Emergency rollback module restoring previous staging snapshots and backups
- [[validate.sh]] — Structural integrity check verifying pack non-emptiness and manifest presence
- [[ingest-obsidian.sh]] — Stages raw repository sources into Obsidian vault for human-driven wiki synthesis
- [[ingest-notebooklm.sh]] — NotebookLM sync orchestrator; validates, chunks, backs up, and uploads knowledge packs
- [[kb-sync-nightly.sh]] — Two-stage nightly orchestrator executing NotebookLM ingest and interactive artifact generation
- [[generate-kb-sync-artifact.mjs]] — Stage 2 report generator; extracts external documentation URLs and compiles interactive HTML dashboard
- [[register-kb-sync-task.ps1]] — Automation script registering the daily scheduled task `KB-Sync-Daily` in Windows Task Scheduler
- [[check-status.mjs]] — CLI status dashboard and telemetry inspector for kb-sync pipeline
- [[detect-drift.ts]] — Phase 1 Knowledge Freshness & Drift Detection analyzer
- [[generate-delta-summary.ts]] — Phase 2 Ingest Delta Summarization snapshot diffing module
- [[audit-coverage.ts]] — Phase 3 Observability & Coverage Analytics linter and score metrics

---

## Concepts

### Architecture & Design Patterns

- [[fail-soft-orchestration]] — Run all KB sync targets regardless of individual failures; aggregate results at end
- [[pack-based-knowledge-management]] — Flatten entire repository into single knowledge pack for LLM context
- [[immutable-staging]] — Each sync creates timestamped, immutable staging directory; preserves historical versions
- [[karpathy-llm-wiki-pattern]] — Three-layer vault (raw sources → wiki → logs); human-in-the-loop curation with LLM synthesis
- [[deterministic-sync-pipeline]] — Idempotent, reproducible execution with traceable checksum manifests
- [[raw-source-staging]] — Pre-ingest freezing of source files for delta comparison and human ingest guidance
- [[manifest-mode]] — Checksum-verified relative path mapping during pack consolidation

---

## Cross-Reference Map

### By Domain

- **Orchestration & Pipeline:** [[run-all.sh]], [[kb-sync-nightly.sh]], [[register-kb-sync-task.ps1]], [[fail-soft-orchestration]], [[deterministic-sync-pipeline]]
- **NotebookLM Integration:** [[ingest-notebooklm.sh]], [[generate-kb-sync-artifact.mjs]], [[pack-based-knowledge-management]]
- **Obsidian Vault:** [[ingest-obsidian.sh]], [[karpathy-llm-wiki-pattern]], [[immutable-staging]], [[raw-source-staging]], [[generate-delta-summary.ts]]
- **Core Utilities:** [[flatten.sh]], [[chunk.sh]], [[validate.sh]], [[rollback.sh]], [[manifest-mode]]
- **Telemetry & Quality:** [[detect-drift.ts]], [[audit-coverage.ts]]

---

## How To Use This Wiki

1. **For understanding kb-sync architecture:** Start with concepts, then explore related entities
2. **For understanding a specific component:** Find entity in this Index, follow cross-references
3. **For audit trail of all changes:** See [[Log.md]]
4. **For semantic ingest workflow:** See `modules/wiki/operator-workflow.md`
5. **For wiki schema and conventions:** See `modules/wiki/schema.md`
