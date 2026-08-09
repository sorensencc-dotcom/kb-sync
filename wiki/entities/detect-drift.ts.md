---
title: "detect-drift.ts"
category: "utilities"
status: "active"
type: entity
tags: [wiki, drift, telemetry]
created: 2026-08-01
---

# `detect-drift.ts`

`modules/wiki/detect-drift.ts` implements Phase 1 Knowledge Freshness & Drift Detection.

## Responsibilities

- **Timestamp & Hash Drift Analysis**: Compares git commit timestamps and file SHA256 hashes against `wiki/Log.md` / `.sync-status.json`.
- **Telemetry Reporting**: Writes findings to `.drift-report.json`.
- **Self-Healing Backlog Trigger**: Appends remediation tasks to `TODOS.md` when stale pages >5 (with deduplication guards).

## Related Concepts & Modules

- [[kb-sync/entities/generate-delta-summary.ts]]
- [[kb-sync/entities/audit-coverage.ts]]
