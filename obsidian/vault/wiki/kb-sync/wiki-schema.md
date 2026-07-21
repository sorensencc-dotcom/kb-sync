---
title: "Wiki Schema"
category: "sync-tools"
status: "active"
---

# Wiki Schema

**Type:** Module Documentation  
**Location:** `modules/wiki/schema.md`  
**Status:** Active  
**Last Updated:** 2026-07-17 via nightly sync

## Summary

Defines the three-layer Karpathy LLM-wiki pattern architecture for kb-sync Obsidian vault: raw sources (immutable), wiki (LLM-maintained), and schema (stable reference). Specifies entity/concept page templates, Index.md and Log.md structure, naming conventions, linking rules, and wiki governance principles.

## Attributes

- **Input:** Repository sources flattened into `.nlm_pack/repo_knowledge_pack.txt`
- **Output:** Structured wiki with indexed entities, concepts, cross-references, and append-only update log
- **Side Effects:** Defines page conventions that guide all ingest sessions and enforce consistency across wiki updates
- **Constraints:** Schema itself is stable reference; never auto-modified during ingest passes. All updates append to Log.md only.

## Relationships

- **Used in workflows:** [Wiki Ingest Workflow](./wiki-ingest-workflow.md), [Wiki Query Workflow](./wiki-query-workflow.md), [Wiki Lint Workflow](./wiki-lint-workflow.md)
- **Depends on:** [Karpathy LLM-Wiki Pattern](../concepts/karpathy-llm-wiki-pattern.md), [Pack-Based Knowledge Management](../concepts/pack-based-knowledge-management.md)
- **Referenced by:** [operator-workflow.md](#), [lint-rules.md](#), [update-rules.md](#)

## Cross-References

- Related concepts: [[kb-sync/concepts/karpathy-llm-wiki-pattern|Karpathy LLM-Wiki Pattern]], [[kb-sync/concepts/pack-based-knowledge-management|Pack-Based Knowledge Management]], [[kb-sync/concepts/three-layer-vault-architecture|Three-Layer Vault Architecture]]
- Related entities: [[kb-sync/kb-sync/wiki-operator-workflow|Wiki Operator Workflow]], [[kb-sync/kb-sync/wiki-lint-rules|Wiki Lint Rules]], [[kb-sync/kb-sync/wiki-update-rules|Wiki Update Rules]]

## Source Citations

- **Primary source:** `modules/wiki/schema.md` (full file)
- **Pack reference:** Section "--- START FILE: modules/wiki/schema.md ---"

## Implementation Notes

The schema defines three template types:
1. **Entity pages** — concrete things with attributes, relationships, and source citations
2. **Concept pages** — abstract patterns with definitions, examples, and governance notes
3. **Index.md** — catalog with entities, concepts, and cross-reference maps
4. **Log.md** — append-only audit trail of all wiki updates with pack hashes and operator names

All wiki pages must follow these templates exactly. Link validation (bidirectional, no broken links) is enforced via lint workflow.

