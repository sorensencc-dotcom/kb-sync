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
- **Depends on:** [[pack-based-knowledge-management]], [[fail-soft-orchestration]]
- **Used in workflows:** Nightly Knowledge Base Sync Workflow

## Cross-References

- Related entities: [[kb-sync-nightly.sh]], [[flatten.sh]], [[validate.sh]], [[rollback.sh]]
- Related concepts: [[pack-based-knowledge-management]], [[immutable-staging]]
- Backlinks from: [[Index.md]], [[kb-sync-nightly.sh]]

## Source Citations

- **Primary source:** `modules/notebooklm/ingest-notebooklm.sh`
- **Config source:** `configs/notebooklm.yaml`
