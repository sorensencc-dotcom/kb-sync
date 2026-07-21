---
title: "run-all.sh"
category: "utilities"
status: "active"
---

# run-all.sh

**Type:** Script  
**Location:** `core/run-all.sh`  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Summary

Master orchestrator script that executes all pipeline stages in sequence: flatten → pack → purge → upload → verify. Entry point for `npm run kb:sync`.

The script coordinates flattening the repository using pyragify, consolidating output into a knowledge pack, and distributing to configured targets (NotebookLM, Obsidian, wiki systems). It is the primary user-facing command for keeping external knowledge bases synchronized with codebase state.

---

## Attributes

### Input
- Environment variables: `OBSIDIAN_VAULT_ROOT`, `NOTEBOOK_ID`, `.env` credentials
- Repository state: current filesystem, git history, pyragify exclusions
- Configuration: `pyragify.yaml`, `configs/*.yaml`

### Output
- `.nlm_pack/repo_knowledge_pack.txt` — consolidated knowledge pack
- `.nlm_pack/repo_knowledge_pack.txt.bak` — rollback backup
- Synced state in NotebookLM, Obsidian vault, wiki system
- Exit code: 0 (success), 1 (failure)

### Side Effects
- Modifies `.nlm_pack/` directory (creates/overwrites pack files)
- Triggers purge/upload operations on external targets
- May create chunked pack files if size exceeds limits
- Updates NotebookLM instance with fresh sources
- Stages files in Obsidian vault `_kb-sync-staging/` directory

### Performance Characteristics
- Runtime: 30–120 seconds (depends on repo size, network latency for NotebookLM API)
- Pack size: typically 3–15 MB (configurable via exclusions)
- Scales linearly with repository size

### Constraints & Limits
- Requires `pyragify` installed and executable
- Requires `.env` with valid `NOTEBOOK_ID` and credentials
- NotebookLM pack upload has 8MB hard limit (script chunks if exceeded)
- Cannot run if previous sync is still in progress (no lock file, potential race condition)

---

## Relationships

### Called By
- User via `npm run kb:sync` command
- CI/CD pipelines on successful main branch builds
- Nightly evaluation runners
- Optional git post-commit hook

### Calls / Depends On
- [[kb-sync/kb-sync/flatten.sh|flatten.sh]] — repository flattening via pyragify
- [[kb-sync/kb-sync/chunk.sh|chunk.sh]] — pack size management
- [[kb-sync/kb-sync/validate.sh|validate.sh]] — output validation
- [[kb-sync/kb-sync/rollback.sh|rollback.sh]] — restore mechanism
- `pyragify` (external CLI)
- `notebooklm-mcp` (external MCP client)

### Related Concepts
- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]] — sequential 6-phase execution model
- [[kb-sync/concepts/pack-based-knowledge-management|Pack-Based Knowledge Management]] — consolidated knowledge representation
- [[kb-sync/concepts/fail-soft-orchestration|Fail-Soft Orchestration]] — continues despite individual stage failures

### Participates In Workflows
- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]]

---

## Cross-References

### Bidirectional Links

- Related entities: [[kb-sync/kb-sync/flatten.sh|flatten.sh]], [[kb-sync/kb-sync/chunk.sh|chunk.sh]], [[kb-sync/kb-sync/validate.sh|validate.sh]], [[kb-sync/kb-sync/rollback.sh|rollback.sh]]
- Related concepts: [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]], [[kb-sync/concepts/pack-based-knowledge-management|Pack-Based Knowledge Management]]
- Backlinks from: [[kb-sync/kb-sync/index|kb-sync Core Module]]

---

## Source Citations

**Primary Source:** `core/run-all.sh`  
**Related:** `modules/notebooklm/ingest-notebooklm.sh` (target-specific execution)  
**Pack Reference:** `--- START FILE: core/run-all.sh ---` to `--- END FILE: core/run-all.sh ---`

---

## Implementation Notes

The script uses fail-soft orchestration: each stage (flatten, pack, purge, upload, verify) is invoked independently. If one stage fails, subsequent stages may be skipped, but the script attempts to report per-stage status before exiting. This prevents cascading failures from blocking partial progress.

The script backs up the previous pack (`.bak.txt`) before upload, enabling rollback without re-running the expensive flatten stage.
