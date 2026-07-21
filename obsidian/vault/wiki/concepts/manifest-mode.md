---
title: "Manifest Mode"
category: "wiki"
status: "active"
---

# Manifest Mode

**Type:** Pattern  
**Domain:** obsidian, knowledge-management  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Definition

Manifest mode is a safe ingest strategy where [[kb-sync/obsidian/ingest-obsidian.sh|ingest-obsidian.sh]] generates a `FILES.manifest.txt` file listing all staged sources, and Claude Code sessions verify against the manifest before synthesizing wiki content. The manifest acts as a control gate: operators can confirm expected files are present (no missing sources) and no unexpected files were included (no contamination).

---

## Why It Matters

Raw source staging is immutable, but staging itself is error-prone: disk I/O failures, partial copies, path corruption. Manifest mode adds a verification step without requiring re-running the expensive flatten stage. Operators can quickly audit staged content by checking the manifest, catching issues early before wiki synthesis invests effort into stale or corrupted data.

---

## Subconcepts

- **Manifest Generation:** `FILES.manifest.txt` lists path, size, timestamp for each staged file
- **Manifest Verification:** Claude Code compares expected file list against manifest
- **Early Error Detection:** Catch staging issues before wiki synthesis begins
- **Staged Data Confidence:** Operator gains confidence in staged data before synthesizing

---

## Related Concepts

- [[kb-sync/concepts/raw-source-staging|Raw Source Staging]] — produces manifest
- [[kb-sync/concepts/three-layer-vault-architecture|Three-Layer Vault Architecture]] — Layer 1 validation
- [[kb-sync/concepts/semantic-ingest-workflow|Semantic Ingest Workflow]] — Phase 1 (Ingest) uses manifest to verify input

---

## Examples

**Example 1: Successful manifest verification**
- [[kb-sync/obsidian/ingest-obsidian.sh|ingest-obsidian.sh]] stages kb-sync repo → creates `FILES.manifest.txt`
- Manifest lists 47 files (scripts, docs, configs)
- Claude Code Phase 1 (Ingest) verifies manifest: expected count matches
- Confidence: staged data is complete
- Proceed to Phase 2 (Lint)
- Result: no surprises during wiki synthesis

**Example 2: Manifest catches staging error**
- [[kb-sync/obsidian/ingest-obsidian.sh|ingest-obsidian.sh]] stages repo → creates `FILES.manifest.txt`
- Manifest lists 42 files (expected 47) — 5 files missing!
- Claude Code Phase 1 detects discrepancy
- Stops and alerts operator: "Staging incomplete, 5 files missing"
- Operator investigates disk error, re-runs [[kb-sync/obsidian/ingest-obsidian.sh|ingest-obsidian.sh]]
- New manifest now lists all 47 files
- Result: staging error caught before wiki synthesis wastes effort

**Example 3: Manifest enables staged data auditing**
- Multiple teams check out same kb-sync staging (20260711-174821)
- Each team verifies against manifest before local synthesis
- Manifest is immutable (part of staging)
- All teams have same confidence in data integrity
- Result: distributed trust without centralized verification

---

## Cross-References

### Entities That Use This Concept

- [[kb-sync/obsidian/ingest-obsidian.sh|ingest-obsidian.sh]] — generates manifest

### Concepts This Concept Depends On

- [[kb-sync/concepts/raw-source-staging|Raw Source Staging]] — produces manifest
- [[kb-sync/concepts/three-layer-vault-architecture|Three-Layer Vault Architecture]] — Layer 1

### Backlinks From

- [[kb-sync/concepts/raw-source-staging|Raw Source Staging]]
- [[kb-sync/concepts/semantic-ingest-workflow|Semantic Ingest Workflow]]

---

## Source Citations

**Primary Source:** `modules/obsidian/ingest-obsidian.sh` (manifest generation)  
**Usage:** `modules/wiki/operator-workflow.md` Phase 1 (Ingest) — verifies against manifest  
**Schema:** `docs/targets/obsidian.md` (three-layer vault, staging section)  
**Pack Reference:** Manifest files in staging directories (`_kb-sync-staging/**/FILES.manifest.txt`)

---

## Governance & Rules

**Enforcement:**
- Every staging run must generate a manifest
- Manifest must be immutable (never edited after creation)
- Operators should verify manifest before proceeding with wiki synthesis

**Decision Gates:**
- Phase 1 (Ingest) of [[kb-sync/concepts/semantic-ingest-workflow|Semantic Ingest Workflow]] should include manifest verification

**Exceptions:**
- None; manifest is non-negotiable for staged data integrity

---

## Rationale & History

Early Obsidian vault staging had no verification: operators would discover mid-synthesis that a critical file was missing or corrupted. Manifest mode adds a lightweight verification gate without re-running flatten. The manifest is simple (plain text listing files) and immutable (generated once, never changed), making it a reliable audit trail.

---

## Related Pages

- See [[kb-sync/concepts/raw-source-staging|Raw Source Staging]] for Layer 1 implementation
- See [[kb-sync/concepts/semantic-ingest-workflow|Semantic Ingest Workflow]] Phase 1 for manifest verification workflow
