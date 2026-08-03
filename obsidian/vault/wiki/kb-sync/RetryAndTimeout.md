---
title: "Retry and Timeout Strategy"
category: "utilities"
status: "active"
type: "infrastructure"
source_path: "_kb-sync-staging/kb-sync/20260725-213400"
last_ingest_date: "2026-07-25"
tags: ["reliability", "resilience", "automation", "error-handling"]
---

# Retry and Timeout Strategy

**Module:** `core/` resilience utilities  
**Type:** Infrastructure Utility  
**Language:** Bash  
**Version:** 1.0.0  

## Summary

Configurable retry and timeout mechanism that enables safe, bounded re-execution of failed pipeline stages with exponential backoff, preventing indefinite hangs and cascading failures.

## Purpose

Provides fault tolerance for transient failures (network timeouts, temporary resource unavailability) while ensuring hard termination of genuinely stuck processes, protecting automation infrastructure from deadlocks.

## Key Operations

1. **Timeout Enforcement** — Uses GNU coreutils `timeout` command with configurable duration
2. **Retry Loop** — Automatic re-execution with exponential backoff
3. **Backoff Calculation** — Intervals (5s, 15s, 30s) between attempts
4. **Graceful Fallback** — Runs without timeout if `timeout` command unavailable
5. **Attempt Counting** — Tracks current attempt for diagnostics and backoff selection

## Architecture

```bash
run_with_retry() {
  local attempt=1
  local timeout_sec=$((TIMEOUT_MS / 1000))
  
  while [ "$attempt" -le "$RETRY_ATTEMPTS" ]; do
    if timeout --foreground "$timeout_sec" "$@"; then
      return 0  # Success
    fi
    
    # Exponential backoff before retry
    local backoff_ms=${RETRY_BACKOFF_MS[$((attempt - 1))]}
    sleep $((backoff_ms / 1000))
    
    attempt=$((attempt + 1))
  done
  
  return 1  # All attempts exhausted
}
```

## Configuration

From `configs/global.yaml`:
```yaml
automation:
  bash_workspace:
    timeout_ms: 90000              # 90 seconds per stage
    retry_attempts: 3              # Max 3 attempts
    retry_backoff_ms: [5000, 15000, 30000]  # Exponential backoff
    skip_on_failure: false         # Hard fail, don't skip
    alert_on_failure: true         # Notify on failure
```

## Retry Decision Tree

```
Stage starts
├── First attempt (90s timeout)
│   ├── SUCCESS → Return immediately
│   └── TIMEOUT/FAILURE → Continue to backoff
├── Wait 5 seconds
├── Second attempt (90s timeout)
│   ├── SUCCESS → Return immediately
│   └── TIMEOUT/FAILURE → Continue to backoff
├── Wait 15 seconds
├── Third attempt (90s timeout)
│   ├── SUCCESS → Return immediately
│   └── TIMEOUT/FAILURE → Escalate failure
└── Alert operator + fail stage
```

## Related Entities

- [[kb-sync/kb-sync/KBSyncOrchestration|KB-Sync Orchestration]] — Uses retry strategy for target execution

## Related Concepts

- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]] — Retry enables repeatable execution
- [[kb-sync/concepts/fail-soft-orchestration|Fail-Soft Orchestration]] — Bounds failures to prevent cascades

## Source References

- Raw source: `_kb-sync-staging/kb-sync/20260725-213400/modules/obsidian/ingest-obsidian.sh` (lines 47-84)
- Raw source: `_kb-sync-staging/kb-sync/20260725-213400/configs/global.yaml` (automation section)
- Tests: `_kb-sync-staging/kb-sync/20260725-213400/tests/obsidian-sync-verification.ts`

---

**Last Synthesized:** 2026-07-25 21:34 UTC  
**Status:** Active  
**Maintenance Tier:** Core Infrastructure
