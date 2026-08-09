---
title: "chunk.sh"
category: "utilities"
status: "active"
type: entity
tags: [core, chunking, bash]
created: 2026-08-01
---

# `chunk.sh`

`core/chunk.sh` is a core utility script in `kb-sync` responsible for splitting large consolidated knowledge packs into size-bounded chunks (e.g. 500KB - 2MB) for LLM context limits.

## Responsibilities

- **Size-Bounded Chunking**: Splits large markdown files at heading boundaries.
- **Header Preservation**: Maintains context headers across chunk splits.

## Related Concepts & Scripts

- [[kb-sync/entities/flatten.sh]]
- [[kb-sync/concepts/pack-based-knowledge-management]]
