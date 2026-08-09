---
title: "audit-coverage.ts"
category: "utilities"
status: "active"
type: entity
tags: [wiki, coverage, telemetry]
created: 2026-08-01
---

# `audit-coverage.ts`

`modules/wiki/audit-coverage.ts` implements Phase 3 Observability & Coverage Analytics.

## Responsibilities

- **Coverage Score Calculation**: Computes Source-to-Wiki Coverage Score %: `(Mapped Sources / Total Tracked Sources) * 100`.
- **Link Health Linter**: Scans markdown links and wikilinks across `wiki/` and `docs/` to flag dead links and missing target anchors.
- **Telemetry Reporting**: Writes findings to `.coverage-report.json`.

## Related Concepts & Modules

- [[kb-sync/entities/detect-drift.ts]]
- [[kb-sync/entities/generate-delta-summary.ts]]
