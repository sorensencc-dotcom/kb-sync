---
title: "kb-sync-nightly.sh"
category: "utilities"
status: "active"
---

# kb-sync-nightly.sh

**Type:** Script  
**Location:** `scripts/notebooklm/kb-sync-nightly.sh`  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Summary

Nightly scheduled sync task runner for automated synchronization in CI/CD and edge-node evaluation environments.

Invokes the full kb-sync pipeline (`npm run kb:sync`) on a cron schedule (typically nightly) to ensure all agents and developers are grounded with fresh codebase context every morning.

---

## Attributes

### Input
- Cron schedule trigger (typically 00:00 UTC daily)
- Environment: CI/CD environment or edge-node evaluation runner
- Repository state: current filesystem, configuration

### Output
- Synced NotebookLM, Obsidian, wiki targets
- Cron job log (success/failure status)
- Exit code: 0 (success), non-zero (failure)

### Side Effects
- Runs full kb-sync pipeline (flatten, pack, upload)
- Updates external knowledge bases
- May block other scheduled tasks if runtime exceeds cron interval

### Performance Characteristics
- Runs once per day (typically overnight to minimize impact)
- Duration: 30–120 seconds (full pipeline)
- No impact on daytime development workflows

### Constraints & Limits
- Requires cron scheduling infrastructure (Linux/macOS or Windows Task Scheduler)
- Requires all kb-sync environment variables and credentials to be available
- Cannot retry within same cron interval if failed (must wait until next scheduled run)

---

## Relationships

### Called By
- Cron scheduler (system task)
- CI/CD orchestrator (on main branch builds)
- Edge-node evaluation runner

### Calls / Depends On
- [[kb-sync/kb-sync/run-all.sh|run-all.sh]] — full pipeline execution
- npm environment

### Related Concepts
- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]]

### Participates In Workflows
- CI/CD automation workflows
- Nightly evaluation workflows

---

## Cross-References

### Bidirectional Links

- Related entities: [[kb-sync/kb-sync/run-all.sh|run-all.sh]], [[kb-sync/notebooklm/register-kb-sync-task.ps1|register-kb-sync-task.ps1]]
- Related concepts: [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]]
- Backlinks from: [[kb-sync/notebooklm/index|notebooklm module]]

---

## Source Citations

**Primary Source:** `scripts/notebooklm/kb-sync-nightly.sh`  
**Related:** Cron scheduling, CI/CD integration  
**Pack Reference:** `--- START FILE: scripts/notebooklm/kb-sync-nightly.sh ---` to `--- END FILE: scripts/notebooklm/kb-sync-nightly.sh ---`

---

## Implementation Notes

The script is designed to run unattended (no user interaction). It captures exit code and logs output for debugging if the sync fails. Failure notification (e.g., Slack alert) can be configured by the CI/CD orchestrator or cron-wrapper.

The script should be idempotent: running it twice in sequence should produce the same result as running it once (assuming repository state hasn't changed between runs).
