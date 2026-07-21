# run-all.sh

**Type**: Core Orchestration Script  
**Location**: `core/run-all.sh`  
**Purpose**: Master orchestrator for multi-target KB sync pipeline

---

## Summary

Master script that orchestrates all KB sync targets (NotebookLM, Obsidian, etc.) using fail-soft orchestration. Each target is invoked independently; failure of one target does not block others.

---

## Scope

- Invokes all SYNC_TARGETS (notebooklm, obsidian) sequentially
- Implements fail-soft behavior: continues on target failure
- Reports aggregated results after all targets complete
- Supports `--rollback` flag for reverting all changes

---

## Key Operations

| Operation | Command | Notes |
|-----------|---------|-------|
| Run all targets | `./core/run-all.sh` | Fails soft; all targets invoked |
| Rollback all | `./core/run-all.sh --rollback` | Reverts each target's changes |

---

## Calls

- `modules/notebooklm/ingest-notebooklm.sh` — NotebookLM ingestion target
- `modules/obsidian/ingest-obsidian.sh` — Obsidian staging target
- `core/flatten.sh` (via targets) — File flattening for packs

---

## Side Effects

- Generates `.nlm_pack/repo_knowledge_pack.txt` (from flatten)
- Stages raw sources to `_kb-sync-staging/<repo>/<timestamp>/` (Obsidian)
- Updates rollback state for each target

---

## Dependencies

- Bash 4.0+
- `core/flatten.sh`, `core/chunk.sh`, `core/validate.sh` (core utilities)
- `configs/global.yaml` (shared configuration)

---

## Metadata

- **Source Version**: Stage hash TBD  
- **Last Ingest**: [Awaiting first synthesis]  
- **Related Entities**: [[flatten.sh]], [[chunk.sh]], [[validate.sh]]  
- **Related Concepts**: [[fail-soft-orchestration]], [[deterministic-sync-pipeline]]

---

## Raw Source

**File**: `core/run-all.sh`  
**Staged**: `_kb-sync-staging/kb-sync/20260720-003223/core/run-all.sh`  
**Availability**: Immutable reference in staging layer; all line numbers valid at ingest date.
