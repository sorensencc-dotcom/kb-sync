# Knowledge Base Index

**Last Updated:** 2026-07-25 04:40 UTC  
**Pack Hash:** (from 20260725-041226 staging)  
**Total Entities:** 7  
**Total Concepts:** 4  

---

## Entities

### Core Scripts & Orchestration

- [[run-all.sh]] — Master orchestrator for multi-target KB sync pipeline (fail-soft orchestration)
- [[flatten.sh]] — Generates file manifests and concatenates sources into knowledge packs
- [[ingest-obsidian.sh]] — Stages raw repository sources into Obsidian vault for human-driven wiki synthesis
- [[ingest-notebooklm.sh]] — NotebookLM sync orchestrator; validates, chunks, backs up, and uploads knowledge packs
- [[kb-sync-nightly.sh]] — Two-stage nightly orchestrator executing NotebookLM ingest and interactive artifact generation
- [[generate-kb-sync-artifact.mjs]] — Stage 2 report generator; extracts external documentation URLs and compiles interactive HTML dashboard
- [[register-kb-sync-task.ps1]] — Automation script registering the daily scheduled task `KB-Sync-Daily` in Windows Task Scheduler

---

## Concepts

### Architecture & Design Patterns

- [[fail-soft-orchestration]] — Run all KB sync targets regardless of individual failures; aggregate results at end
- [[pack-based-knowledge-management]] — Flatten entire repository into single knowledge pack for LLM context
- [[immutable-staging]] — Each sync creates timestamped, immutable staging directory; preserves historical versions
- [[karpathy-llm-wiki-pattern]] — Three-layer vault (raw sources → wiki → logs); human-in-the-loop curation with LLM synthesis

---

## Cross-Reference Map

### By Domain

- **Orchestration & Pipeline:** [[run-all.sh]], [[kb-sync-nightly.sh]], [[register-kb-sync-task.ps1]], [[fail-soft-orchestration]]
- **NotebookLM Integration:** [[ingest-notebooklm.sh]], [[generate-kb-sync-artifact.mjs]], [[pack-based-knowledge-management]]
- **Obsidian Vault:** [[ingest-obsidian.sh]], [[karpathy-llm-wiki-pattern]], [[immutable-staging]]
- **Core Utilities:** [[flatten.sh]]

---

## How To Use This Wiki

1. **For understanding kb-sync architecture:** Start with concepts, then explore related entities
2. **For understanding a specific component:** Find entity in this Index, follow cross-references
3. **For audit trail of all changes:** See [[Log.md]]
4. **For semantic ingest workflow:** See `modules/wiki/operator-workflow.md`
5. **For wiki schema and conventions:** See `modules/wiki/schema.md`
