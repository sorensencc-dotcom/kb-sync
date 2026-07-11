# flatten.sh

**Type:** Script  
**Location:** `core/flatten.sh`  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Summary

Repository flattening script that invokes pyragify to scan, parse (AST), and extract repository content according to exclusion rules defined in `pyragify.yaml`.

Produces raw extracted file content that serves as input to the pack consolidation stage. Handles both code files (`.ts`, `.py`, etc.) and documentation (`.md`), applying language-specific parsing where needed.

---

## Attributes

### Input
- Repository filesystem: all files, directory structure
- Configuration: `pyragify.yaml` (exclusion rules, AST parsers)
- Environment: Python environment (pyragify via `uv run`)

### Output
- Stdout: extracted and filtered file contents (used by [[chunk.sh]] and pack stage)
- Exit code: 0 (success), 1 (parsing error or exclusion conflict)

### Side Effects
- Parses AST of code files (may consume memory for large files)
- Respects `.gitignore`, `pyragify.yaml` exclusions
- Does not modify filesystem

### Performance Characteristics
- Runtime: 5–30 seconds (depends on repository size and AST parsing complexity)
- Memory: ~100–500 MB (for large monorepos)
- I/O bound (disk reads)

### Constraints & Limits
- Requires `pyragify` to be installed and executable (`uv run` environment)
- Only supports languages with AST parsers registered in pyragify (TS, Python, etc.)
- Cannot handle binary files (images, compiled objects)
- Exclusion rules are static (cannot be modified at runtime)

---

## Relationships

### Called By
- [[run-all.sh]] — master orchestrator

### Calls / Depends On
- `pyragify` (external tool)
- `.gitignore`, `pyragify.yaml` (configuration)

### Related Concepts
- [[Pack-Based Knowledge Management]] — upstream step in pack creation

### Participates In Workflows
- [[Deterministic Sync Pipeline]] — Phase 2: Flatten

---

## Cross-References

### Bidirectional Links

- Related entities: [[run-all.sh]], [[chunk.sh]]
- Related concepts: [[Pack-Based Knowledge Management]]
- Backlinks from: [[kb-sync Core Module]]

---

## Source Citations

**Primary Source:** `core/flatten.sh`  
**Related:** `pyragify.yaml` (exclusion configuration)  
**Pack Reference:** `--- START FILE: core/flatten.sh ---` to `--- END FILE: core/flatten.sh ---`

---

## Implementation Notes

The script uses `uv run pyragify` to delegate AST parsing to the pyragify tool. This separation keeps kb-sync agnostic to language-specific parsing details. The script streams output (does not buffer entire flattened tree in memory), allowing large repositories to be processed with bounded memory.
