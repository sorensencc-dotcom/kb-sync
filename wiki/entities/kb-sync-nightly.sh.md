---
title: "kb sync nightly.sh"
category: "wiki"
status: "active"
---

# kb-sync-nightly.sh

**Type:** Script / Orchestrator  
**Location:** `scripts/notebooklm/kb-sync-nightly.sh`  
**Status:** Active  
**Last Updated:** 2026-07-25  

## Summary

`kb-sync-nightly.sh` is the two-stage master orchestrator script triggered by Windows Task Scheduler (`KB-Sync-Daily`). It executes Stage 1 (syncing repository documentation to Google NotebookLM via `ingest-notebooklm.sh`) and Stage 2 (generating an interactive HTML report via `generate-kb-sync-artifact.mjs`).

## Attributes

- **Input:** Repository codebase, `.env`, `configs/`
- **Output:** Synced NotebookLM sources, interactive HTML report (`_integration/kb-sync-interactive-report.html`)
- **Side Effects:** Updates external knowledge base and local report artifacts
- **Performance:** Execution duration ~10-15s total
- **Constraints:** Executed via bash under Windows Task Scheduler or npm CLI

## Relationships

- **Called by:** `npm run kb:sync`, Windows Task Scheduler (`KB-Sync-Daily`)
- **Calls:** [[kb-sync/entities/ingest-notebooklm.sh]], [[kb-sync/entities/generate-kb-sync-artifact.mjs]]
- **Depends on:** [[kb-sync/concepts/fail-soft-orchestration]], [[kb-sync/concepts/karpathy-llm-wiki-pattern]]
- **Used in workflows:** Scheduled Nightly Pipeline Workflow

## Cross-References

- Related entities: [[kb-sync/entities/ingest-notebooklm.sh]], [[kb-sync/entities/generate-kb-sync-artifact.mjs]], [[kb-sync/entities/register-kb-sync-task.ps1]]
- Related concepts: [[kb-sync/concepts/fail-soft-orchestration]], [[kb-sync/concepts/immutable-staging]]
- Backlinks from: [[kb-sync/wiki/Index]], [[kb-sync/entities/register-kb-sync-task.ps1]]

## Source Citations

- **Primary source:** `scripts/notebooklm/kb-sync-nightly.sh`
- **Package source:** `package.json`
