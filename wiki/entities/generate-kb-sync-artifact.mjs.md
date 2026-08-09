---
title: "generate kb sync artifact.mjs"
category: "wiki"
status: "active"
---

# generate-kb-sync-artifact.mjs

**Type:** Node.js Script / Module  
**Location:** `scripts/notebooklm/generate-kb-sync-artifact.mjs`  
**Status:** Active  
**Last Updated:** 2026-07-25  

## Summary

`generate-kb-sync-artifact.mjs` is the Stage 2 artifact generator script. It parses knowledge pack files (`.nlm_pack/*.txt`), extracts all external URLs and documentation references across the codebase, ranks link frequency, and compiles a self-contained interactive HTML dashboard report (`_integration/kb-sync-interactive-report.html`).

## Attributes

- **Input:** `.nlm_pack/repo_knowledge_pack.txt`
- **Output:** `_integration/kb-sync-interactive-report.html`
- **Side Effects:** Writes HTML report artifact to disk
- **Performance:** Execution duration ~1-2s
- **Constraints:** Requires Node.js v18+

## Relationships

- **Called by:** [[kb-sync/entities/kb-sync-nightly.sh]]
- **Calls:** Node `fs`, `path` modules
- **Depends on:** [[kb-sync/concepts/pack-based-knowledge-management]]
- **Used in workflows:** Stage 2 Artifact Generation Workflow

## Cross-References

- Related entities: [[kb-sync/entities/kb-sync-nightly.sh]], [[kb-sync/entities/ingest-notebooklm.sh]]
- Related concepts: [[kb-sync/concepts/pack-based-knowledge-management]]
- Backlinks from: [[kb-sync/wiki/Index]], [[kb-sync/entities/kb-sync-nightly.sh]]

## Source Citations

- **Primary source:** `scripts/notebooklm/generate-kb-sync-artifact.mjs`
