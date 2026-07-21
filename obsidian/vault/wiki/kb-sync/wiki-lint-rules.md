# Wiki Lint Rules

**Type:** Module Documentation  
**Location:** `modules/wiki/lint-rules.md`  
**Status:** Active  
**Last Updated:** 2026-07-17 via nightly sync

## Summary

Defines structural, referential, and semantic checks for wiki integrity. Enforces consistent entity/concept page structure, bidirectional link validation, no broken references, no contradictory definitions, and up-to-date status markers. Used during lint phases of wiki synthesis workflow.

## Attributes

- **Input:** Current wiki state (entities/, concepts/, Index.md, Log.md)
- **Output:** Lint report with violations, fixes, and verification status
- **Side Effects:** Identifies broken links, orphan pages, contradictions, and stale content
- **Constraints:** Lint checks do not modify wiki; only report findings for operator review and correction

## Relationships

- **Used in:** [Wiki Operator Workflow](./wiki-operator-workflow.md) (Phase 2 and Phase 5)
- **Validates:** [[Wiki Schema]], [[Wiki Structure]]
- **Depends on:** [[Pack-Based Knowledge Management]]
- **Part of:** [Wiki Ingest Workflow](./wiki-ingest-workflow.md)

## Cross-References

- Related concepts: [[Karpathy LLM-Wiki Pattern]], [[Wiki Quality Assurance]]
- Related entities: [[Wiki Schema]], [[Wiki Operator Workflow]], [[Wiki Update Rules]]

## Source Citations

- **Primary source:** `modules/wiki/lint-rules.md` (full file)
- **Pack reference:** Section "--- START FILE: modules/wiki/lint-rules.md ---"

## Implementation Notes

Lint rules are organized in three categories:

1. **Structural Checks (S1–S5):** Verify all entities/concepts have pages, pages are listed in Index.md, required headers present, no duplicates
2. **Referential Integrity Checks (R1–R5):** Verify all links are valid, bidirectional, no undocumented circular dependencies, citations exist in pack
3. **Semantic Checks (SE1–SE5):** Verify definitions are consistent, summaries match current implementation, status markers are documented, examples are accurate

Lint is run twice in workflow: after current wiki is read (Phase 2), then after all updates are made (Phase 5).

