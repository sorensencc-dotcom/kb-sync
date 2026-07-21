---
title: "Pack-Based Knowledge Management"
category: "wiki"
status: "active"
---

# Pack-Based Knowledge Management

**Type:** Design Pattern  
**Domain:** kb-sync, knowledge-management  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Definition

Pack-based knowledge management represents a codebase as a single consolidated text file (`repo_knowledge_pack.txt`) containing all source files, delimited by structured markers (`--- START FILE:` / `--- END FILE:`). This pack serves as the single source of truth for all downstream knowledge systems (NotebookLM, wiki, Obsidian).

---

## Why It Matters

External knowledge systems often have limitations (NotebookLM's 50-source limit, API size constraints). By consolidating sources into a single pack, kb-sync bypasses these limitations and ensures consistency: all knowledge systems read from the same data, eliminating divergence. The pack format is simple and language-agnostic (plain text with delimiters), enabling integration with any system that can read text.

The pack also serves as an audit trail: operators can inspect exactly what was ingested into external systems by examining the pack at a specific timestamp.

---

## Subconcepts

- **Flattening:** Repository transformation via pyragify into consolidated file list
- **Chunking:** Pack splitting for size management (NotebookLM 8MB limit)
- **Validation:** Pack integrity checks (delimiter counts, size expectations)
- **Versioning:** Timestamped packs for historical reference

---

## Related Concepts

- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]] — orchestrates pack creation and distribution
- [[kb-sync/concepts/three-layer-vault-architecture|Three-Layer Vault Architecture]] — raw sources and pack as Layer 1

---

## Examples

**Example 1: [[kb-sync/kb-sync/flatten.sh|flatten.sh]] creates the pack**
- Scans repository with pyragify (AST-aware extraction)
- Applies exclusion rules from `pyragify.yaml`
- Outputs flattened file list (stdout)
- Result: single data stream ready for consolidation

**Example 2: [[kb-sync/kb-sync/chunk.sh|chunk.sh]] manages size constraints**
- NotebookLM API has 8MB hard limit per source
- If pack exceeds 8MB, chunking splits it into line-safe parts
- Upload stage processes chunks individually
- Result: large codebases can be synced without truncation

**Example 3: [[kb-sync/kb-sync/validate.sh|validate.sh]] ensures consistency**
- Verifies pack has correct delimiter structure (every file has START and END marker)
- Confirms file count matches expectation
- Detects truncation or corruption
- Result: downstream systems receive valid, intact pack

---

## Cross-References

### Entities That Use This Concept

- [[kb-sync/kb-sync/flatten.sh|flatten.sh]] — creates pack
- [[kb-sync/kb-sync/chunk.sh|chunk.sh]] — manages pack size
- [[kb-sync/kb-sync/validate.sh|validate.sh]] — verifies pack integrity
- [[kb-sync/kb-sync/run-all.sh|run-all.sh]] — orchestrates pack lifecycle

### Concepts This Concept Depends On

- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]] — orchestration

### Backlinks From

- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]]
- [[kb-sync/concepts/karpathy-llm-wiki-pattern|Karpathy LLM-Wiki Pattern]]

---

## Source Citations

**Primary Source:** Pack format spec (file delimiters: `--- START FILE:` / `--- END FILE:`)  
**Implementation:** `core/flatten.sh`, `core/chunk.sh`, `core/validate.sh`  
**Configuration:** `pyragify.yaml` (exclusion rules)  
**Pack Reference:** `.nlm_pack/repo_knowledge_pack.txt` (actual pack files)

---

## Governance & Rules

**Enforcement:**
- Packs must be validated before distribution (Phase 6: Verify)
- Backups must be created after successful upload (enables rollback)
- Pack size must respect hard limit (8MB) or be chunked

**Decision Gates:**
- Validation phase (Phase 6) must pass before sources are distributed

**Exceptions:**
- None; pack validation is non-negotiable

---

## Rationale & History

Early kb-sync implementations synced sources individually to each target (NotebookLM, Obsidian, wiki). This led to inconsistency: each target might cache a different version of the source, or one target might fail while others succeeded. Consolidating into a single pack ensures:

1. **Consistency:** All targets consume identical data
2. **Simplicity:** One data format (plain text) works everywhere
3. **Auditability:** Single pack file is easy to inspect, backup, and version
4. **Rollback:** Previous packs can be restored without re-running flatten

The pack format (file delimiters) is deliberately simple to avoid vendor lock-in or dependency on specific tools.

---

## Related Pages

- See [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]] for pack lifecycle orchestration
- See [[kb-sync/concepts/raw-source-staging|Raw Source Staging]] for how packs inform wiki synthesis
