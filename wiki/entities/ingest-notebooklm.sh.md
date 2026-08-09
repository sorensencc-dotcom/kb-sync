---
title: "ingest notebooklm.sh"
category: "wiki"
status: "active"
---

# ingest-notebooklm.sh

**Type:** Script / Module  
**Location:** `modules/notebooklm/ingest-notebooklm.sh`  
**Status:** Active  
**Last Updated:** 2026-07-25  

## Summary

`ingest-notebooklm.sh` is the NotebookLM sync orchestrator module. It flattens repository documentation, validates size thresholds, chunks oversized pack files if necessary, creates rollback backups, and purges/uploads knowledge packs to Google NotebookLM using `notebooklm.exe`.

## Attributes

- **Input:** `.env` configuration, `configs/global.yaml`, `configs/notebooklm.yaml`, repository files
- **Output:** Knowledge pack `.nlm_pack/repo_knowledge_pack.txt`, backup archives, NotebookLM API upload
- **Side Effects:** Removes old sources in NotebookLM and uploads updated knowledge pack
- **Performance:** Fast execution (~5–10 seconds)
- **Constraints:** Requires valid Google authentication via `notebooklm.exe` / `storage_state.json`

## Relationships

- **Called by:** `scripts/notebooklm/kb-sync-nightly.sh`, `npm run kb:sync`
- **Calls:** `core/flatten.sh`, `core/validate.sh`, `core/chunk.sh`, `core/rollback.sh`, `notebooklm.exe`
- **Depends on:** [[kb-sync/concepts/pack-based-knowledge-management]], [[kb-sync/concepts/fail-soft-orchestration]]
- **Used in workflows:** Nightly Knowledge Base Sync Workflow

## Cross-References

- Related entities: [[kb-sync/entities/kb-sync-nightly.sh]], [[kb-sync/entities/flatten.sh]], [[kb-sync/entities/validate.sh]], [[kb-sync/entities/rollback.sh]]
- Related concepts: [[kb-sync/concepts/pack-based-knowledge-management]], [[kb-sync/concepts/immutable-staging]]
- Backlinks from: [[kb-sync/wiki/Index]], [[kb-sync/entities/kb-sync-nightly.sh]]

## Source Citations

- **Primary source:** `modules/notebooklm/ingest-notebooklm.sh`
- **Config source:** `configs/notebooklm.yaml`
