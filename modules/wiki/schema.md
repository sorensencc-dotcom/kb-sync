# Wiki Schema & Structure

## Three-Layer Architecture

The Karpathy LLM-wiki pattern defines three immutable layers:

### Layer 1: Raw Sources
- Located: `.nlm_pack/repo_knowledge_pack.txt`
- Read-only snapshot of flattened repository at ingest time
- Contains full file content with `--- START FILE:` / `--- END FILE:` delimiters
- Never edited; source of truth for fact-checking and citations

### Layer 2: The Wiki
- Located: `wiki/`
- LLM-maintained semantic structure (entities, concepts, relationships)
- Human-readable catalog and audit trail
- Updated via manual ingest sessions, never auto-modified
- Three-part structure:
  - **Index.md** — catalog of all entities/concepts (curated list)
  - **Log.md** — append-only audit trail of all semantic updates
  - **entities/** — concrete things (classes, functions, systems)
  - **concepts/** — abstract ideas (patterns, principles, architectures)

### Layer 3: Schema & Configuration
- Located: `modules/wiki/schema.md`, `modules/wiki/lint-rules.md`, `modules/wiki/update-rules.md`
- Defines wiki structure, page conventions, workflow rules
- Not versioned per session; stable reference for all ingest passes
- Used to train LLM on wiki conventions during ingest sessions

---

## Index.md Structure

```markdown
# Knowledge Base Index

**Last Updated:** [YYYY-MM-DD HH:MM UTC]  
**Pack Hash:** [first 7 chars of pack sha256]

## Entities

- [EntityName](entities/entity-name.md) — One-line summary of what this entity is/does
- ...

## Concepts

- [ConceptName](concepts/concept-name.md) — One-line summary of the principle/pattern/rule
- ...

## Cross-Reference Map

### By Category
- [Category Name]: entity-1, entity-2, entity-3; concept-x, concept-y
- ...

### By Domain
- [Domain Name]: entity-1, entity-2; concept-x, concept-y
- ...

```

---

## Log.md Structure

```markdown
# Semantic Update Log

All entries timestamped and immutable. Append-only.

## [2026-07-11 09:30 UTC] Initial wiki synthesis from pack

- Source pack: `.nlm_pack/repo_knowledge_pack.txt`
- Pack hash: abc1234def567890
- Changes: 12 entities created, 8 concepts created, 34 cross-refs established
- Operator: Chris Sorensen
- Notes: Foundation ingest; all major architectures and components cataloged.

---

## [2026-07-12 14:15 UTC] Wiki update: notebooklm module refactor

- Source pack: `.nlm_pack/repo_knowledge_pack.txt` (hash: xyz9876fab543210)
- Changes: 3 entities updated (ingest-notebooklm.sh, core/flatten.sh, core/validate.sh), 2 new concepts (Manifest Mode, Fail-Soft Orchestration)
- Deleted: 1 orphan concept (Deprecated PyRagify Branch)
- Cross-refs added: 5 backlinks from entities to new concepts
- Operator: Claude Code (supervised by Chris Sorensen)
- Notes: Extraction of modular pipeline; manifest mode enables Obsidian staging. Lint pass identified no contradictions.

---

```

---

## Entity Page Template

```markdown
# [EntityName]

**Type:** [Function | Class | Module | System | Script | File | etc.]  
**Location:** [File path or module location in repo]  
**Status:** [Active | Deprecated | In Development | Archived]  
**Last Updated:** [YYYY-MM-DD] via Log entry [link to Log.md #section]

## Summary

[One paragraph: what is this entity, why does it exist, who uses it?]

## Attributes

- **Input:** [What does it take in?]
- **Output:** [What does it produce?]
- **Side Effects:** [What else happens?]
- **Performance:** [Speed, memory, limits?]
- **Constraints:** [What can't it do?]

## Relationships

- **Called by:** [Entity1], [Entity2]
- **Calls:** [Entity3], [Entity4]
- **Depends on:** [Concept1], [Concept2]
- **Used in workflows:** [WorkflowName1], [WorkflowName2]

## Cross-References

- Related entities: [[Entity5]], [[Entity6]]
- Related concepts: [[Concept1]], [[Concept3]]
- Backlinks from: [[Entity7]], [[Concept2]]

## Source Citations

- **Primary source:** `path/to/file.sh` lines 10–45
- **Related source:** `path/to/other.md`
- **Pack reference:** Section "--- START FILE: path/to/file.sh ---"

## Implementation Notes

[Any architectural decisions, gotchas, or non-obvious behavior?]

```

---

## Concept Page Template

```markdown
# [ConceptName]

**Type:** [Pattern | Principle | Architecture | Rule | Workflow | etc.]  
**Domain:** [kb-sync | wiki | notebooklm | obsidian | etc.]  
**Status:** [Active | Deprecated | Proposed | etc.]  
**Last Updated:** [YYYY-MM-DD] via Log entry [link to Log.md #section]

## Definition

[One paragraph: formal definition of this concept.]

## Why It Matters

[Context: problem it solves, cost of ignoring it, benefits of following it.]

## Subconcepts

- [Subconcept1]: definition
- [Subconcept2]: definition

## Related Concepts

- [[Concept1]] — relationship
- [[Concept2]] — relationship

## Examples

- Example 1: [Entity] follows this pattern by [doing X]
- Example 2: [Entity] violates this principle by [doing Y] (notes on consequences)

## Cross-References

- Related entities: [[Entity1]], [[Entity2]]
- Related concepts: [[Concept3]], [[Concept4]]
- Backlinks from: [[Entity3]], [[Concept5]]

## Source Citations

- **Primary source:** `docs/path/to/doc.md`
- **Code examples:** `path/to/file.sh` lines 30–50
- **Pack reference:** Section "--- START FILE: path/to/file.md ---"

## Governance Notes

[Any rules, constraints, or decision gates that enforce this concept?]

```

---

## Naming Conventions

- **Entity pages:** `entities/kebab-case-name.md` (exact match to thing name, lowercase, dashes for spaces)
- **Concept pages:** `concepts/kebab-case-name.md`
- **Link format in markdown:** `[[EntityName]]` or `[[ConceptName]]` (title case, double brackets)
- **Backlinks:** pages referencing this page list it under "Backlinks from:"

---

## Linking Rules

- **Bidirectional:** If A links to B, B must link back to A (via "Related X" or "Backlinks")
- **No broken links:** Every `[[Link]]` must resolve to an existing page
- **No dangling entities:** Every entity in Index.md must have a page file
- **No orphan pages:** Every page must be referenced by Index.md or another page

---

## Wiki Governance

1. **Pack is source of truth.** Ingest from `.nlm_pack/repo_knowledge_pack.txt`, never arbitrary edits.
2. **Log is immutable.** All updates recorded with timestamp, source pack hash, entity/concept counts.
3. **Schema is stable.** Never auto-modify schema docs during ingest; they guide the LLM, not describe past changes.
4. **Cross-refs are verified.** Before committing, lint pass confirms all links are bidirectional and valid.
5. **Index.md is canonical.** Only entities/concepts in Index.md are "official"; others are drafts or orphans.
6. **No autonomous writes.** Only operator (via Claude Code) can approve and commit wiki changes; never background agents.

