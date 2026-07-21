# Wiki Update Rules

**Type:** Module Documentation  
**Location:** `modules/wiki/update-rules.md`  
**Status:** Active  
**Last Updated:** 2026-07-17 via nightly sync

## Summary

Rules for creating, updating, and removing entity and concept pages during semantic ingest phases. Covers identification of new/changed entities and concepts, template-based page creation/modification, Index.md updates, and stale page handling. Ensures consistent wiki evolution across ingest sessions.

## Attributes

- **Input:** Ingest phase output (lists of new entities, new concepts, modified entities, stale pages)
- **Output:** Updated wiki with new/modified pages, updated Index.md and relationships
- **Side Effects:** Ensures wiki schema compliance and consistent page structure
- **Constraints:** No auto-deletion of stale pages; all removals require operator approval documented in Log.md

## Relationships

- **Used in:** [Wiki Operator Workflow](./wiki-operator-workflow.md) (Phases 1, 3, 4, 6)
- **References:** [[Wiki Schema]], [[Wiki Lint Rules]]
- **Depends on:** [[Pack-Based Knowledge Management]]
- **Part of:** [Wiki Ingest Workflow](./wiki-ingest-workflow.md)

## Cross-References

- Related concepts: [[Karpathy LLM-Wiki Pattern]], [[Wiki Semantic Synthesis]]
- Related entities: [[Wiki Schema]], [[Wiki Operator Workflow]], [[Wiki Lint Rules]]

## Source Citations

- **Primary source:** `modules/wiki/update-rules.md` (full file)
- **Pack reference:** Section "--- START FILE: modules/wiki/update-rules.md ---"

## Implementation Notes

Update rules are organized by workflow phase:

1. **Ingest Phase (I1–I4):** Identify all new entities, new concepts, changed relationships, and stale pages by scanning pack and comparing to Log.md history

2. **Update Phase (U1–U6):** Create new entity/concept pages from templates, update existing pages with changed content, handle stale pages (flag for review, defer deletion), and rebuild Index.md

Key principles:
- All pages created from templates ([[Wiki Schema]])
- Names become kebab-case filenames
- Bidirectional links established in Cross-Ref phase
- No autonomous page deletions; all require operator approval
- Index.md rebuilt after all updates

