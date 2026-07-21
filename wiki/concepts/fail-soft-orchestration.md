# Fail-Soft Orchestration

**Type**: Operational Pattern  
**Domain**: kb-sync architecture  
**Status**: Active

---

## Problem

When running multiple independent tasks (KB sync targets: NotebookLM, Obsidian, future targets), what happens if one target fails?

**Naive approach**: Stop immediately (fail-fast). Result: Other targets never run; partial sync.

**kb-sync approach**: Continue executing all targets regardless of individual failures. Aggregate results and report at end.

---

## Solution

**Fail-soft orchestration** (aka "best-effort sequencing"): Run all targets in sequence; catch and log failures; proceed to next target; report all results at end.

### Implementation

In `core/run-all.sh`:

```bash
for target in "${SYNC_TARGETS[@]}"; do
  if ! bash "$target" 2>&1 | tee -a "$LOG_FILE"; then
    log_warn "Target failed: $target"
    ((TARGET_FAILURES++))
  fi
done
```

Result: If notebooklm fails, obsidian still runs. Both results are logged and reported.

### Advantages

- **Maximizes utility**: Even if one KB source fails, others succeed
- **Transparency**: All failures visible in single report
- **Debugging**: Easier to identify which targets work and which don't
- **Rollback safety**: Each target can roll back independently

---

## Examples

**Scenario**: Obsidian vault staging fails due to missing config.

**Fail-fast**: NotebookLM pack generated, but obsidian never attempts staging. Must re-run entire pipeline.

**Fail-soft**: NotebookLM pack generated; Obsidian fails cleanly; Report shows "Obsidian: FAILED (missing vault_root)"; NotebookLM result preserved.

---

## Related Concepts

- [[deterministic-sync-pipeline]] — Repeatability and auditability work together with fail-soft
- [[immutable-staging]] — Failed staging can be rolled back safely

---

## Related Entities

- [[run-all.sh]] — Master orchestrator implementing fail-soft pattern
- [[ingest-obsidian.sh]] — Demonstrates fail-fast behavior at script level (exits on error)

---

## Notes

**Distinction**: Fail-soft at orchestration level (run all targets) vs. fail-fast at individual script level (each script exits on error). This hybrid approach is deliberate: individual scripts are strict; the orchestrator is forgiving.

---

## Metadata

- **Introduced**: kb-sync v1.0  
- **Source Domain**: `core/run-all.sh`  
- **Ingest Date**: 2026-07-20  
- **Last Updated**: [TBD]
