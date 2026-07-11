# validate.sh

**Type:** Script  
**Location:** `core/validate.sh`  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Summary

Pack integrity validation script that verifies knowledge pack structure, confirms presence of expected file delimiters, and checks for corruption or truncation.

Runs as post-pack step to ensure consolidated pack is ready for distribution to NotebookLM, Obsidian, and wiki targets.

---

## Attributes

### Input
- `.nlm_pack/repo_knowledge_pack.txt` — consolidated pack
- `.nlm_pack/repo_knowledge_pack_part_*.txt` — chunked parts (if applicable)
- Configuration: validation rules (delimiter counts, size expectations)

### Output
- Exit code: 0 (valid), 1 (validation failed)
- Stdout: validation report (file count, delimiter count, total size)

### Side Effects
- None (read-only operation)

### Performance Characteristics
- Runtime: ~1–3 seconds (linear in pack size)
- I/O bound (reads pack file sequentially)
- Memory efficient (streaming validation)

### Constraints & Limits
- Assumes pack file exists
- Cannot detect semantic corruption (only structural issues)
- Does not validate file content (only file delimiters)

---

## Relationships

### Called By
- [[run-all.sh]] — master orchestrator

### Calls / Depends On
- `.nlm_pack/repo_knowledge_pack.txt` — input

### Related Concepts
- [[Pack-Based Knowledge Management]] — validates pack consistency

### Participates In Workflows
- [[Deterministic Sync Pipeline]] — Phase 6: Verify

---

## Cross-References

### Bidirectional Links

- Related entities: [[run-all.sh]], [[flatten.sh]], [[chunk.sh]]
- Related concepts: [[Pack-Based Knowledge Management]]
- Backlinks from: [[kb-sync Core Module]]

---

## Source Citations

**Primary Source:** `core/validate.sh`  
**Related:** Pack format spec (file delimiters: `--- START FILE:` / `--- END FILE:`)  
**Pack Reference:** `--- START FILE: core/validate.sh ---` to `--- END FILE: core/validate.sh ---`

---

## Implementation Notes

Validation checks:
1. All pack files are readable and non-empty
2. File delimiter counts match expected structure (for each file, one START and one END marker)
3. Total size is within expected range (no catastrophic truncation)
4. Chunked parts (if present) form a valid sequence (no gaps, correct ordering)

Semantic validation (e.g., correct file paths, expected function definitions) is out of scope; that is delegated to downstream consumers (NotebookLM, wiki synthesis).
