---
title: "deterministic-sync-pipeline"
category: "wiki"
status: "active"
type: concept
tags: [pipeline, orchestration, determinism]
created: 2026-08-01
---

# Deterministic Sync Pipeline

The **Deterministic Sync Pipeline** is a core architectural pattern in `kb-sync`. It guarantees reproducible, idempotent staging and processing of raw source repositories into structured knowledge artifacts (`.nlm_pack/` and `wiki/`).

## Key Characteristics

1. **Fail-Soft Execution**: Every target stage runs independently wrapped with error boundaries (`|| true`).
2. **Immutable Staging**: Sources are snapshotted into timestamped subdirectories (`_kb-sync-staging/<repo>/<timestamp>/`).
3. **Traceable Manifests**: Every pass records file hashes and list manifests (`manifest.txt`).

## Related Entities & Concepts

- [[kb-sync/entities/run-all.sh]]
- [[kb-sync/concepts/raw-source-staging]]
- [[kb-sync/concepts/manifest-mode]]
