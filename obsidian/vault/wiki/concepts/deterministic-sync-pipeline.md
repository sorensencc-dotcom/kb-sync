---
title: "Deterministic Sync Pipeline"
category: "wiki"
status: "active"
---

# Deterministic Sync Pipeline

**Type:** Architecture, Workflow  
**Domain:** kb-sync, orchestration  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Definition

The deterministic sync pipeline is a six-phase, sequential execution model for synchronizing a local codebase with external knowledge systems. Phases execute in strict order (Trigger → Flatten → Pack → Purge → Upload → Verify); each phase is independent and reports its outcome. The pipeline is deterministic (same input always produces same output) and stateless (no inter-phase state carries forward except via artifacts like the pack file).

---

## Why It Matters

Determinism and sequentiality prevent race conditions and cascading failures. Each phase has well-defined inputs and outputs; if phase N fails, phase N+1 is skipped but the pipeline doesn't crash. This enables operators to identify exactly where issues occur (e.g., "flatten succeeded, but pack upload failed") and recover via rollback without re-running expensive stages.

The six-phase model also maps cleanly to distributed execution: each phase can be deployed as an independent task, enabling parallel fallback targets (NotebookLM, Obsidian, wiki) without coupling.

---

## Subconcepts

- **Phase 1 (Trigger):** User initiates sync via `npm run kb:sync` or scheduled task
- **Phase 2 (Flatten):** Repository extraction via pyragify (AST-aware parsing)
- **Phase 3 (Pack):** Consolidation into single knowledge pack with chunking for size management
- **Phase 4 (Purge):** Remove old sources from external targets (NotebookLM, etc.)
- **Phase 5 (Upload):** Distribute fresh pack to external knowledge systems
- **Phase 6 (Verify):** Validate pack integrity and sync completion status

---

## Related Concepts

- [[kb-sync/concepts/pack-based-knowledge-management|Pack-Based Knowledge Management]] — Phase 3 produces consolidated pack
- [[kb-sync/concepts/fail-soft-orchestration|Fail-Soft Orchestration]] — execution model for phase coordination
- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]] — overall orchestration

---

## Examples

**Example 1: [[kb-sync/kb-sync/run-all.sh|run-all.sh]] orchestrates all six phases**
- Phase 1: User runs `npm run kb:sync`
- Phase 2: [[kb-sync/kb-sync/flatten.sh|flatten.sh]] extracts repository via pyragify
- Phase 3: [[kb-sync/kb-sync/chunk.sh|chunk.sh]] consolidates and chunks if needed
- Phase 4: [[kb-sync/notebooklm/ingest-notebooklm.sh|ingest-notebooklm.sh]] purges old NotebookLM sources
- Phase 5: [[kb-sync/notebooklm/ingest-notebooklm.sh|ingest-notebooklm.sh]] uploads fresh pack
- Phase 6: [[kb-sync/kb-sync/validate.sh|validate.sh]] confirms integrity
- Result: external systems are synchronized with latest codebase

**Example 2: Fail-soft execution enables recovery**
- Phase 5 (Upload to NotebookLM) fails due to API error
- Phase 6 (Verify) detects failure and reports status
- Operator can immediately retry upload without re-running expensive flatten stage
- [[kb-sync/kb-sync/rollback.sh|rollback.sh]] can restore previous known-good pack
- Result: operator has clear recovery path

**Example 3: Determinism enables testing**
- Same repository state + same exclusion rules → same pack
- Running pipeline twice in a row produces identical results
- Allows operators to verify "no changes" by checking pack hash
- Result: high confidence in sync correctness

---

## Cross-References

### Entities That Use This Concept

- [[kb-sync/kb-sync/run-all.sh|run-all.sh]] — master orchestrator
- [[kb-sync/kb-sync/flatten.sh|flatten.sh]] — Phase 2
- [[kb-sync/kb-sync/chunk.sh|chunk.sh]] — Phase 3
- [[kb-sync/notebooklm/ingest-notebooklm.sh|ingest-notebooklm.sh]] — Phases 4, 5
- [[kb-sync/kb-sync/validate.sh|validate.sh]] — Phase 6

### Concepts This Concept Depends On

- [[kb-sync/concepts/pack-based-knowledge-management|Pack-Based Knowledge Management]] — Phase 3 output
- [[kb-sync/concepts/fail-soft-orchestration|Fail-Soft Orchestration]] — execution model

### Backlinks From

- [[kb-sync/concepts/fail-soft-orchestration|Fail-Soft Orchestration]]
- [[kb-sync/kb-sync/index|kb-sync Core Module]]

---

## Source Citations

**Primary Source:** `docs/kb/notebooklm-sync/pipeline.md` (6-phase pipeline specification)  
**Implementation:** `core/run-all.sh` and related scripts  
**Architecture:** `docs/kb/notebooklm-sync/architecture.md`  
**Pack Reference:** Multiple files implement phases (flatten.sh, chunk.sh, ingest-*.sh, validate.sh)

---

## Governance & Rules

**Enforcement:**
- Phases must execute in order (no skipping ahead)
- Each phase must report success/failure before proceeding
- Rollback script enables recovery from Phase 4–6 failures

**Decision Gates:**
- Phase 6 (Verify) must pass before external systems are considered synchronized

**Exceptions:**
- None; pipeline order is non-negotiable

---

## Rationale & History

Early kb-sync implementations used loose orchestration (fire and forget), leading to partial sync states where some targets updated while others failed. The six-phase deterministic model provides clear phases, enabling operators to identify failures, verify progress, and recover safely.

The model also enables future parallelization: once verified, independent phase logic can be deployed as microservices or serverless functions, each with clear input/output contracts.

---

## Related Pages

- See [[kb-sync/concepts/pack-based-knowledge-management|Pack-Based Knowledge Management]] for Phase 3 data model
- See [[kb-sync/concepts/fail-soft-orchestration|Fail-Soft Orchestration]] for Phase coordination pattern
- See [[kb-sync/kb-sync/rollback.sh|rollback.sh]] for recovery mechanism
