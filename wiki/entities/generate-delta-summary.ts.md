---
title: "generate-delta-summary.ts"
category: "utilities"
status: "active"
type: entity
tags: [wiki, delta, prompt]
created: 2026-08-01
---

# `generate-delta-summary.ts`

`modules/wiki/generate-delta-summary.ts` implements Phase 2 Ingest Delta Summarization.

## Responsibilities

- **Staging Snapshot Diffs**: Compares consecutive timestamped directories under `_kb-sync-staging/`.
- **Operator Prompt Augmentation**: Formats file diff summaries (added/modified/deleted) and injects them into operator prompt output during [[kb-sync/entities/ingest-obsidian.sh]].
- **Baseline Handling**: Provides baseline fallbacks when <2 staging snapshots exist.

## Related Concepts & Modules

- [[kb-sync/concepts/raw-source-staging]]
- [[kb-sync/entities/ingest-obsidian.sh]]
