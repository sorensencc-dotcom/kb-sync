# Wiki Operator Workflow

**Type:** Module Documentation  
**Location:** `modules/wiki/operator-workflow.md`  
**Status:** Active  
**Last Updated:** 2026-07-17 via nightly sync

## Summary

Complete guide for running a wiki semantic ingest session via Claude Code. Covers 8-phase workflow: Ingest, Lint, Update, Cross-Ref, Lint, Log, Review, and Commit. Enables human-in-the-loop wiki synthesis from flattened repository knowledge packs.

## Attributes

- **Input:** Repository knowledge pack (`.nlm_pack/repo_knowledge_pack.txt`), existing wiki (Index.md, Log.md, entities/, concepts/), schema docs (schema.md, lint-rules.md, update-rules.md)
- **Output:** Updated wiki with new/changed entities, concepts, cross-references, and append-only Log.md entry
- **Side Effects:** Git commit with change summary; wiki becomes source of truth for synthesized knowledge
- **Constraints:** No autonomous writes; only human operator (via Claude Code session) can approve and commit changes

## Relationships

- **Part of:** [Wiki Ingest Workflow](./wiki-ingest-workflow.md)
- **Uses:** [[Wiki Schema]], [[Wiki Lint Rules]], [[Wiki Update Rules]]
- **Depends on:** [Karpathy LLM-Wiki Pattern](../concepts/karpathy-llm-wiki-pattern.md)
- **References:** [[Pack-Based Knowledge Management]]

## Cross-References

- Related concepts: [[Karpathy LLM-Wiki Pattern]], [[Pack-Based Knowledge Management]]
- Related entities: [[Wiki Schema]], [[Wiki Lint Rules]], [[Wiki Update Rules]]

## Source Citations

- **Primary source:** `modules/wiki/operator-workflow.md` (full file)
- **Pack reference:** Section "--- START FILE: modules/wiki/operator-workflow.md ---"

## Implementation Notes

The 8-phase workflow is:
1. **Ingest** — Identify new/changed entities and concepts from pack
2. **Lint** — Verify current wiki for structural/semantic issues
3. **Update** — Create/modify entity and concept pages
4. **Cross-Ref** — Establish bidirectional links between entities and concepts
5. **Lint** — Re-verify after updates for consistency
6. **Log** — Append dated entry to wiki/Log.md with pack hash and change summary
7. **Review** — Spot-check updated pages for accuracy and completeness
8. **Commit** — Git commit with descriptive message

Each phase includes specific Claude Code prompts to guide LLM-assisted synthesis while maintaining human approval gates.

