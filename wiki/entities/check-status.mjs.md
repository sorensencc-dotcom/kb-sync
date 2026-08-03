---
type: entity
tags: [wiki, status, dashboard, CLI]
created: 2026-08-03
---

# `check-status.mjs`

`scripts/check-status.mjs` provides the CLI status dashboard for the `kb-sync` pipeline (`npm run kb:status`).

## Responsibilities

- **Telemetry Inspection**: Reads `.sync-status.json` for sync health, timestamp, file counts, pack size, and URL tracking stats.
- **Log Verification**: Checks the `logs/` directory for recent NotebookLM and Obsidian pipeline execution logs.
- **Staging Verification**: Inspects `_kb-sync-staging/kb-sync` to verify the latest staged snapshot and manifest.

## Related Concepts & Modules

- [[audit-coverage.ts]]
- [[detect-drift.ts]]
- [[run-all.sh]]
