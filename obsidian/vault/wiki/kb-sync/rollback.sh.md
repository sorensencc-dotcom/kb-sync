---
title: "rollback.sh"
category: "utilities"
status: "active"
---

# rollback.sh

**Type:** Script  
**Location:** `core/rollback.sh`  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Summary

Rollback mechanism that restores the last known working pack backup (`.nlm_pack/*.bak.txt`) to replace potentially corrupted or problematic current pack.

Enables operators to quickly recover from failed sync runs or bad source uploads without re-running the expensive flatten stage.

---

## Attributes

### Input
- `.nlm_pack/repo_knowledge_pack.txt.bak` — previous pack backup
- Configuration: rollback targets (which external systems to rollback)

### Output
- Restored `.nlm_pack/repo_knowledge_pack.txt`
- Restored state in NotebookLM, Obsidian, wiki targets
- Exit code: 0 (success), 1 (failure)

### Side Effects
- Overwrites current pack with backup
- Re-uploads backup pack to external targets (NotebookLM, Obsidian, wiki)
- Does not re-run flatten or pack creation (uses cached backup)

### Performance Characteristics
- Runtime: ~10–20 seconds (just upload, no flatten)
- Much faster than re-running full sync
- Network-bound (API calls to external targets)

### Constraints & Limits
- Requires backup file to exist (created by [[kb-sync/kb-sync/run-all.sh|run-all.sh]] after successful upload)
- Can only rollback one generation (oldest backup is overwritten by new sync)
- Backup must be less than hard limit (8 MB)

---

## Relationships

### Called By
- Operator via `npm run kb:sync:rollback` command
- Maintenance and incident response workflows

### Calls / Depends On
- `.nlm_pack/repo_knowledge_pack.txt.bak` — backup source
- External sync targets (NotebookLM, Obsidian, wiki)

### Related Concepts
- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]] — fallback mechanism

### Participates In Workflows
- Incident response workflows

---

## Cross-References

### Bidirectional Links

- Related entities: [[kb-sync/kb-sync/run-all.sh|run-all.sh]]
- Related concepts: [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]]
- Backlinks from: [[kb-sync/kb-sync/index|kb-sync Core Module]]

---

## Source Citations

**Primary Source:** `core/rollback.sh`  
**Related:** Backup strategy (`.bak` file creation)  
**Pack Reference:** `--- START FILE: core/rollback.sh ---` to `--- END FILE: core/rollback.sh ---`

---

## Implementation Notes

The rollback script is designed to be fast and non-destructive. It never modifies the current pack in place before confirming the rollback target exists and is valid. Backup files are created immediately after successful upload, ensuring the most recent known-good pack is always available for recovery.

Rollback can be triggered by operators when external targets (e.g., NotebookLM) report malformed pack content or when agents report stale/incorrect code suggestions despite a recent sync.
