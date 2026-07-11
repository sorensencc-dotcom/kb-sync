# Karpathy LLM-Wiki Pattern

**Type:** Design Pattern  
**Domain:** wiki, knowledge-management  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Definition

The Karpathy LLM-wiki pattern is a methodology for maintaining machine-readable knowledge bases where an LLM (or human-supervised LLM) synthesizes semantic structure (entity and concept pages) from raw source code and documentation, with full human review and audit trail. The LLM performs synthesis only when explicitly triggered by a human operator; no automated background updates.

---

## Why It Matters

Traditional vector-embedded knowledge bases suffer from "hallucination drift" — answers diverge from actual source code as the embedding model updates or sources change. The Karpathy pattern prioritizes human oversight and auditability: every fact in the knowledge base is explicitly synthesized from source, logged with timestamp and operator, and bidirectionally linked for traceability. This makes the knowledge base suitable for critical decision-making (e.g., code review, architecture decisions) where accuracy is non-negotiable.

The pattern also decouples knowledge maintenance from source code evolution: when sources move or disappear, wiki pages retain their historical versions and citations remain valid if raw sources are archived.

---

## Subconcepts

- **Semantic Structure:** Entity and concept pages synthesized from raw sources
- **Human-in-the-Loop:** Operator-triggered synthesis with approval gates
- **Audit Trail:** Immutable Log.md recording all changes with timestamps and operator
- **Three-Layer Architecture:** Separates raw sources, wiki, schema into immutable layers
- **Bidirectional Linking:** Entities and concepts cross-reference each other with backlinks

---

## Related Concepts

- [[Three-Layer Vault Architecture]] — implementation of this pattern
- [[Semantic Ingest Workflow]] — 8-phase synthesis workflow
- [[Raw Source Staging]] — data layer providing audit trail

---

## Examples

**Example 1: [[ingest-wiki.sh]] implements this pattern**
- Operator runs Claude Code session to read staged sources
- Identifies new entities (functions, modules, scripts) and concepts (patterns, principles)
- Creates pages from templates, establishing links and cross-references
- All changes logged to Log.md with timestamp and metadata
- Result: knowledge base remains synchronized with source code without drift

**Example 2: [[Three-Layer Vault Architecture]] enables the pattern**
- Raw sources are immutable (Layer 1), so old wiki citations remain valid
- Wiki pages are explicitly synthesized (Layer 2), not auto-generated
- Schema is stable reference (Layer 3), enabling reusable templates and conventions
- Result: human oversight at every stage

**Example 3: [[Deterministic Sync Pipeline]] supports the pattern**
- Flatten stage extracts current source code (Layer 1)
- Pack consolidates into single knowledge source (audit trail)
- Wiki synthesis reads pack and creates entities/concepts
- Log.md records which pack version was used (traceability)
- Result: operators can always trace wiki facts back to specific source versions

---

## Cross-References

### Entities That Use This Concept

- [[ingest-wiki.sh]] — primary orchestrator
- [[ingest-obsidian.sh]] — raw sources layer
- [[run-all.sh]] — coordinates all targets

### Concepts This Concept Depends On

- [[Three-Layer Vault Architecture]] — structural foundation
- [[Pack-Based Knowledge Management]] — data representation

### Backlinks From

- [[Three-Layer Vault Architecture]]
- [[Semantic Ingest Workflow]]
- [[wiki module]]

---

## Source Citations

**Primary Source:** Karpathy's LLM-wiki pattern (referenced in `docs/targets/obsidian.md`)  
**Implementation:** `modules/wiki/operator-workflow.md` (8-phase workflow)  
**Schema:** `modules/wiki/schema.md` (entity/concept templates)  
**Pack Reference:** Architecture and design docs across kb-sync modules

---

## Governance & Rules

**Enforcement:**
- All wiki synthesis is operator-triggered (no automated LLM updates)
- Phase 7 (Review) of workflow requires operator approval before commit
- Log.md is append-only (no retroactive edits to audit trail)
- Raw sources are never edited after staging (only new stagings allowed)

**Decision Gates:**
- Lint pass (Phase 2) must clear all structural violations before proceeding to synthesis
- Cross-reference phase (Phase 4) must establish bidirectional links for all new pages

**Exceptions:**
- Stale pages can be marked `[Deprecated]` and later removed if operator determines they no longer reflect source state

---

## Rationale & History

The Karpathy pattern was designed to address the "knowledge drift" problem where LLM-generated knowledge bases diverge from actual source code over time. By making synthesis explicit, auditable, and human-approved, the pattern ensures the knowledge base remains a reliable reference for developers and agents.

The pattern trades off automation for accuracy: requires human operators (or supervised LLMs) to trigger synthesis sessions, but gains deterministic, traceable, and trustworthy knowledge.

Early kb-sync implementations lacked auditability (no Log.md); the Karpathy pattern adds the missing pieces: explicit synthesis, approval gates, audit trail, and three-layer separation.

---

## Related Pages

- See [[Three-Layer Vault Architecture]] for the structural foundation
- See [[Semantic Ingest Workflow]] for the 8-phase workflow that implements this pattern
- See [[Log.md]] for audit trail examples
