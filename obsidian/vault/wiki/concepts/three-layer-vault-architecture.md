---
title: "Three-Layer Vault Architecture"
category: "wiki"
status: "active"
---

# Three-Layer Vault Architecture

**Type:** Architecture  
**Domain:** wiki, obsidian  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Definition

The three-layer vault architecture separates knowledge management concerns into three immutable, non-overlapping layers: Raw Sources (timestamped, immutable snapshots of external repositories), the Wiki (LLM-maintained semantic structure with human review), and Schema (stable reference documentation defining wiki conventions). Each layer has a distinct role and governance model.

---

## Why It Matters

Separation of concerns prevents coupling the wiki to implementation details. Raw sources remain audit trail and source of truth; the wiki layer provides semantic structure without being locked to source file paths or names. Schema is stable reference (not versioned per session) that trains operators and LLMs on conventions. This architecture enables historical citation (wiki pages can reference specific source versions by absolute path), auditability (Log.md records all synthesis decisions), and scalability (wiki grows independently of raw sources).

Trade-off: requires manual ingest sessions (not automated), but gains human review oversight of synthesis quality and prevents LLM hallucination in knowledge base.

---

## Subconcepts

- **Layer 1: Raw Sources** — Timestamped, immutable snapshots of external repositories in `_kb-sync-staging/`
- **Layer 2: Wiki** — LLM-owned semantic structure (entities, concepts) in `wiki/` with human review and approval
- **Layer 3: Schema** — Stable reference documentation (templates, linting rules, update rules) that defines wiki structure and conventions

---

## Related Concepts

- [[kb-sync/concepts/karpathy-llm-wiki-pattern|Karpathy LLM-Wiki Pattern]] — design pattern implemented by this architecture
- [[kb-sync/concepts/raw-source-staging|Raw Source Staging]] — Layer 1 implementation (immutable staging)
- [[kb-sync/concepts/semantic-ingest-workflow|Semantic Ingest Workflow]] — Layer 2 workflow (wiki synthesis)

---

## Examples

**Example 1: [[kb-sync/obsidian/ingest-obsidian.sh|ingest-obsidian.sh]] implements Layer 1**
- Script stages external repo sources into `_kb-sync-staging/kb-sync/20260711-174821/`
- Directory preserved, files copied, manifest generated
- Timestamps enable historical versioning (previous staging remains intact)
- Result: raw sources are never edited, always auditable

**Example 2: [[kb-sync/wiki/ingest-wiki.sh|ingest-wiki.sh]] manages Layer 2 synthesis**
- Operator runs 8-phase workflow to read staged sources and create entity/concept pages
- Schema docs guide structure and naming conventions
- Log.md records session metadata (timestamp, operator, changes made)
- Result: wiki pages cite specific source versions by absolute path, all decisions logged

**Example 3: Schema stability maintains Layer 3**
- `modules/wiki/schema.md` defines entity/concept templates (never auto-modified during ingest sessions)
- `modules/wiki/lint-rules.md` and `modules/wiki/update-rules.md` are reference, not enforced mechanically
- Templates train Claude Code on wiki conventions without requiring rewrites each session
- Result: consistent structure across all entities/concepts

---

## Cross-References

### Entities That Use This Concept

- [[kb-sync/obsidian/ingest-obsidian.sh|ingest-obsidian.sh]] — implements Layer 1 (raw sources)
- [[kb-sync/wiki/ingest-wiki.sh|ingest-wiki.sh]] — orchestrates Layer 2 (wiki synthesis)

### Concepts This Concept Depends On

- [[kb-sync/concepts/karpathy-llm-wiki-pattern|Karpathy LLM-Wiki Pattern]] — design pattern

### Backlinks From

- [[kb-sync/concepts/raw-source-staging|Raw Source Staging]]
- [[kb-sync/concepts/semantic-ingest-workflow|Semantic Ingest Workflow]]

---

## Source Citations

**Primary Source:** `docs/targets/obsidian.md` (three-layer vault architecture section)  
**Schema Doc:** `modules/wiki/schema.md` (Layer 3 specification)  
**Operator Guide:** `modules/wiki/operator-workflow.md` (Layer 2 workflow)  
**Pack Reference:** Multiple files contribute to this concept (architecture, staging, synthesis)

---

## Governance & Rules

**Enforcement:**
- Raw sources layer: never edited after staging; new staging runs create new timestamped directories
- Wiki layer: only modified via operator-approved Claude Code sessions; all changes logged to Log.md
- Schema layer: stable reference, never auto-modified during ingest sessions

**Decision Gates:**
- Phase 2 (Lint) of [[kb-sync/concepts/semantic-ingest-workflow|Semantic Ingest Workflow]] blocks Phase 3 until no structural violations exist
- Phase 7 (Review) requires operator approval before Phase 8 (Commit)

**Exceptions:**
- Stale raw sources can be deleted manually if storage is constrained (but breaking this rule means wiki pages citing them become broken)

---

## Rationale & History

The three-layer architecture was chosen to implement Karpathy's LLM-wiki pattern while maintaining auditability and human oversight. Early versions coupled the wiki to source file paths, creating brittleness when source files moved or disappeared. The three-layer separation decouples these concerns: raw sources serve as immutable audit trail, wiki provides semantic meaning, schema trains operators without mutation.

The architecture also enables transparent LLM synthesis: because raw sources are not auto-edited, operators can always re-run synthesis with updated understanding without fear of data loss.

---

## Related Pages

- See [[kb-sync/concepts/karpathy-llm-wiki-pattern|Karpathy LLM-Wiki Pattern]] for the foundational design
- See [[kb-sync/concepts/semantic-ingest-workflow|Semantic Ingest Workflow]] for the Layer 2 8-phase workflow
- See [[kb-sync/concepts/raw-source-staging|Raw Source Staging]] for Layer 1 implementation
