---
title: "Semantic Ingest Workflow"
category: "wiki"
status: "active"
---

# Semantic Ingest Workflow

**Type:** Workflow  
**Domain:** wiki, knowledge-management  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Definition

The semantic ingest workflow is an eight-phase, operator-guided process for synthesizing wiki entities and concepts from staged raw sources. Phases are: Ingest (identify changes) → Lint (verify wiki quality) → Update (create/modify pages) → Cross-Ref (establish bidirectional links) → Lint (re-verify) → Log (audit trail) → Review (operator approval) → Commit (git). Each phase has specific prompts and deliverables; no phase is automated.

---

## Why It Matters

The eight-phase workflow ensures systematic, auditable wiki synthesis. Each phase gates the next (e.g., Lint phase blocks Update if structural issues exist); all changes are reviewed and logged. This prevents the "knowledge drift" problem where auto-updated knowledge bases diverge from reality. The workflow also trains operators (and LLMs) on wiki conventions, ensuring consistency across ingest sessions.

---

## Subconcepts

- **Phase 1 (Ingest):** Identify new/updated entities and concepts from raw sources
- **Phase 2 (Lint):** Verify current wiki for structural, semantic, referential issues
- **Phase 3 (Update):** Create/update entity and concept pages
- **Phase 4 (Cross-Ref):** Establish bidirectional links between pages
- **Phase 5 (Lint):** Re-verify wiki after Phase 3-4 updates
- **Phase 6 (Log):** Record session metadata and changes in Log.md
- **Phase 7 (Review):** Operator spot-checks and approves all changes
- **Phase 8 (Commit):** Git commit with detailed change message

---

## Related Concepts

- [[kb-sync/concepts/karpathy-llm-wiki-pattern|Karpathy LLM-Wiki Pattern]] — design pattern this workflow implements
- [[kb-sync/concepts/three-layer-vault-architecture|Three-Layer Vault Architecture]] — workflow operates on Layer 2 (wiki)

---

## Examples

**Example 1: Full workflow for Phase 5 exit**
- Phase 1: Ingest raw sources → identify 12 new entities (scripts, modules)
- Phase 2: Lint → find 3 structural violations (missing entity pages)
- Phase 3: Update → create 12 entity pages, 8 concept pages, fix violations
- Phase 4: Cross-Ref → add links and backlinks to all pages
- Phase 5: Lint → verify no new violations introduced
- Phase 6: Log → record: "Created 12 entities, 8 concepts, 34 cross-refs"
- Phase 7: Review → operator verifies 5 spot-checked pages are correct
- Phase 8: Commit → git commit with full change summary
- Result: wiki is updated, versioned, and auditable

**Example 2: Lint blocking update**
- Phase 1: Identify 5 new entities
- Phase 2: Lint → detect broken links from prior session (reference to deleted page)
- Cannot proceed to Phase 3 (Update) until broken links are fixed
- Operator fixes broken links manually or updates Index.md
- Phase 2 re-runs → lint passes
- Proceed to Phase 3
- Result: wiki consistency enforced before new content is added

**Example 3: Review preventing bad commit**
- Phases 1-6 complete
- Phase 7: Operator spot-checks 3 entity pages
- Finds 1 entity summary is inaccurate (doesn't match source code)
- Returns to Phase 3 (Update) to fix the page
- Re-runs Phase 4–7
- Phase 8: Operator approves and commits
- Result: bad content caught before commit

---

## Cross-References

### Entities That Use This Concept

- [[kb-sync/wiki/ingest-wiki.sh|ingest-wiki.sh]] — orchestrates workflow
- [[kb-sync/kb-sync/run-all.sh|run-all.sh]] — calls wiki ingestion as target

### Concepts This Concept Depends On

- [[kb-sync/concepts/karpathy-llm-wiki-pattern|Karpathy LLM-Wiki Pattern]] — design pattern
- [[kb-sync/concepts/three-layer-vault-architecture|Three-Layer Vault Architecture]] — wiki layer (Layer 2)

### Backlinks From

- [[kb-sync/concepts/karpathy-llm-wiki-pattern|Karpathy LLM-Wiki Pattern]]
- [[kb-sync/wiki/index|wiki module]]

---

## Source Citations

**Primary Source:** `modules/wiki/operator-workflow.md` (complete 8-phase guide)  
**Schema:** `modules/wiki/schema.md` (entity/concept templates)  
**Lint Rules:** `modules/wiki/lint-rules.md` (Phase 2/5 rules)  
**Update Rules:** `modules/wiki/update-rules.md` (Phase 3 guidance)  
**Pack Reference:** Multiple docs define workflow phases

---

## Governance & Rules

**Enforcement:**
- Phase 2 (Lint) must pass before Phase 3 (Update) starts (blockers only, warnings allowed)
- Phase 7 (Review) requires operator sign-off before Phase 8 (Commit)
- Log.md entry must be complete before commit

**Decision Gates:**
- Phase 7 (Review) is manual gate; operator can reject changes and return to earlier phases

**Exceptions:**
- None; workflow order is non-negotiable

---

## Rationale & History

Early wiki ingest approaches were ad-hoc: no consistent phases, no lint gates, no audit trail. This led to wiki decay (contradictions accumulating, broken links not caught). The eight-phase workflow codifies best practices: systematic identification (Phase 1), quality gate (Phase 2), structured synthesis (Phase 3-5), audit trail (Phase 6), human approval (Phase 7), versioning (Phase 8).

The workflow is designed to be operator-paced (no automation), ensuring human oversight at every critical decision point.

---

## Related Pages

- See [[kb-sync/concepts/karpathy-llm-wiki-pattern|Karpathy LLM-Wiki Pattern]] for design intent
- See [[kb-sync/concepts/three-layer-vault-architecture|Three-Layer Vault Architecture]] for Layer 2 (wiki) details
- See [[kb-sync/Log|Log.md]] for audit trail examples
