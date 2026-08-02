---
type: entity
tags: [scripts, housekeeping, cleanup]
created: 2026-08-01
---

# `cleanup-logs-and-backups.mjs`

`scripts/cleanup-logs-and-backups.mjs` is an automated housekeeping utility that rotates and cleans up stale `.nlm_pack.backup.*` directories and old log files.

## Responsibilities

- **Backup Pruning**: Deletes staging backup directories older than retention thresholds.
- **Log Rotation**: Cleans up dated execution logs under `logs/`.

## CLI Entry

- `npm run logs:cleanup`
