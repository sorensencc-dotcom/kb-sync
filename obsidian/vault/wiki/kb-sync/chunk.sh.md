---
title: "chunk.sh"
category: "utilities"
status: "active"
---

# chunk.sh

**Type:** Script  
**Location:** `core/chunk.sh`  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Summary

Pack size management script that chunks oversized knowledge packs into multiple line-safe parts when pack size exceeds configured limits (5 MB warning, 8 MB hard limit).

Produces `repo_knowledge_pack_part_aa.txt`, `repo_knowledge_pack_part_ab.txt`, etc., each under the hard limit, ensuring safe upload to NotebookLM API and other targets.

---

## Attributes

### Input
- `.nlm_pack/repo_knowledge_pack.txt` — consolidated pack (potentially oversized)
- Configuration: size limits (5 MB warning, 8 MB hard limit)

### Output
- `.nlm_pack/repo_knowledge_pack_part_*.txt` — chunked pack files (if oversized)
- `.nlm_pack/repo_knowledge_pack.txt` — original pack (preserved, not truncated)
- Chunk manifest (metadata about chunking, used by upload stage)

### Side Effects
- Creates multiple files in `.nlm_pack/` directory
- Does not modify original pack file

### Performance Characteristics
- Runtime: ~1–5 seconds (linear in pack size)
- I/O bound (reads pack, writes chunks)
- Memory efficient (streams, does not load entire pack)

### Constraints & Limits
- Assumes pack file exists
- Chunk splitting is line-safe (respects `--- START FILE:` / `--- END FILE:` delimiters to avoid mid-file splits)
- Hard limit (8 MB) is NotebookLM API constraint

---

## Relationships

### Called By
- [[kb-sync/kb-sync/run-all.sh|run-all.sh]] — master orchestrator

### Calls / Depends On
- `.nlm_pack/repo_knowledge_pack.txt` — input pack

### Related Concepts
- [[kb-sync/concepts/pack-based-knowledge-management|Pack-Based Knowledge Management]] — manages pack size constraints

### Participates In Workflows
- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]] — Phase 3: Pack (size management)

---

## Cross-References

### Bidirectional Links

- Related entities: [[kb-sync/kb-sync/run-all.sh|run-all.sh]], [[kb-sync/kb-sync/validate.sh|validate.sh]]
- Related concepts: [[kb-sync/concepts/pack-based-knowledge-management|Pack-Based Knowledge Management]]
- Backlinks from: [[kb-sync/kb-sync/index|kb-sync Core Module]]

---

## Source Citations

**Primary Source:** `core/chunk.sh`  
**Related:** NotebookLM API size limits (8 MB)  
**Pack Reference:** `--- START FILE: core/chunk.sh ---` to `--- END FILE: core/chunk.sh ---`

---

## Implementation Notes

Chunking is line-safe to preserve file delimiters. The script respects `--- START FILE:` and `--- END FILE:` markers, ensuring no file content is split across chunk boundaries. This allows downstream stages to reconstruct the full pack or process chunks individually without data corruption.
