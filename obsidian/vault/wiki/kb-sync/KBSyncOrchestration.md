---
title: "KB-Sync Orchestration"
category: "entity"
type: "infrastructure"
source_path: "_kb-sync-staging/kb-sync/20260725-213400"
last_ingest_date: "2026-07-25"
tags: ["orchestration", "pipeline", "bash", "automation"]
---

# KB-Sync Orchestration

**Module:** `core/run-all.sh`  
**Type:** Master Orchestrator Script  
**Language:** Bash  
**Version:** 1.0.0  

## Summary

Master orchestration script that executes the complete kb-sync pipeline across multiple targets (NotebookLM, Obsidian) using fail-soft execution strategy.

## Purpose

Provides a single entry point (`npm run kb:sync:all`) to execute all configured sync targets sequentially with graceful error handling. If one target fails, others continue executing.

## Key Operations

1. **Target Discovery** — Reads `SYNC_TARGETS` environment variable or config
2. **Execution Loop** — Iterates through each target (notebooklm, obsidian)
3. **Fail-Soft Handling** — Logs failures but continues to next target
4. **Status Reporting** — Aggregates results and reports final status
5. **Rollback Support** — `--rollback` flag reverts each target in reverse order

## Architecture

```
run-all.sh
├── Load config (global.yaml)
├── For each SYNC_TARGET:
│   ├── Run target-specific ingest script
│   ├── Check exit code
│   ├── Log result (success/failure)
│   └── Continue to next target (fail-soft)
└── Report aggregated status
```

## Configuration

Reads from `configs/global.yaml`:
- `timeout_ms` — Timeout per target (90000ms default)
- `retry_attempts` — Retry count (3 default)
- `retry_backoff_ms` — Backoff intervals

## Related Entities

- [[kb-sync/kb-sync/flatten.sh|flatten.sh]] — File extraction
- [[kb-sync/kb-sync/chunk.sh|chunk.sh]] — Pack chunking
- [[kb-sync/kb-sync/validate.sh|validate.sh]] — Pack validation

## Related Concepts

- [[kb-sync/concepts/fail-soft-orchestration|Fail-Soft Orchestration]]
- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]]

## Source References

- Raw source: `_kb-sync-staging/kb-sync/20260725-213400/core/run-all.sh`
- Configuration: `_kb-sync-staging/kb-sync/20260725-213400/configs/global.yaml`
- Tests: `_kb-sync-staging/kb-sync/20260725-213400/tests/core-scripts-verification.ts`

---

**Last Synthesized:** 2026-07-25 21:34 UTC  
**Status:** Active  
**Maintenance Tier:** Core Infrastructure
