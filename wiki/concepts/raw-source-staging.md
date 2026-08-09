---
title: "raw-source-staging"
category: "wiki"
status: "active"
type: concept
tags: [staging, immutability, audit]
created: 2026-08-01
---

# Raw Source Staging

**Raw Source Staging** is the first phase of the Karpathy LLM-wiki workflow in `kb-sync`. Before any LLM processing or wiki synthesis occurs, raw source code and documentation are copied into immutable timestamped directories under `_kb-sync-staging/`.

## Workflow Role

- **Immutable Audit Trail**: Preserves exact source state at ingestion time.
- **Delta Analysis**: Enables [[kb-sync/entities/generate-delta-summary.ts]] to compute changes between consecutive passes.
- **Human Ingest Guidance**: Serves as the frozen target for human/Claude synthesis sessions.

## Related Entities & Concepts

- [[kb-sync/entities/ingest-obsidian.sh]]
- [[kb-sync/entities/generate-delta-summary.ts]]
- [[kb-sync/concepts/karpathy-llm-wiki-pattern]]
