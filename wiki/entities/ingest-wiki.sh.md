---
type: entity
tags: [wiki, ingest, obsidian]
created: 2026-08-01
---

# `ingest-wiki.sh`

`modules/obsidian/ingest-wiki.sh` validates staging directories and generates operator prompts for human-in-the-loop Obsidian wiki synthesis.

## Responsibilities

- **Staging Validation**: Asserts staged raw source file presence and manifests.
- **Operator Prompt Generation**: Output guidance for Claude Code ingest sessions.

## Related Concepts

- [[ingest-obsidian.sh]]
- [[karpathy-llm-wiki-pattern]]
