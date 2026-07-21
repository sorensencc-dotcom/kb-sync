---
title: "ingest-obsidian.sh"
category: "sync-tools"
status: "active"
---

# ingest-obsidian.sh

**Type:** Script  
**Location:** `modules/obsidian/ingest-obsidian.sh`  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Summary

Obsidian vault staging script that captures external repository sources as timestamped, immutable snapshots in the vault's `_kb-sync-staging/` directory.

Preserves directory structure and generates a file manifest for auditability. Enables human-in-the-loop wiki synthesis via Claude Code sessions: raw sources are read, entities and concepts are identified, and wiki pages are created interactively.

---

## Attributes

### Input
- External repository path (configurable via `OBSIDIAN_VAULT_ROOT` env var or `configs/obsidian.yaml`)
- Mapping rules: domain folder assignments based on source repository prefix
- Directory structure from source repository
- File manifest generation rules

### Output
- Timestamped staging directory: `vault_root/_kb-sync-staging/<repo>/<YYYYMMDD-HHMMSS>/`
- Flattened directory structure preserving relative paths
- `FILES.manifest.txt` — manifest listing all staged files
- Exit code: 0 (success), 1 (error)

### Side Effects
- Creates new timestamped directory in `_kb-sync-staging/`
- Does not modify existing wiki content (raw sources only, no synthesis)
- Does not edit source repository

### Performance Characteristics
- Runtime: 5–30 seconds (depends on repository size)
- I/O bound (file copies)
- Scales linearly with source size

### Constraints & Limits
- Requires `OBSIDIAN_VAULT_ROOT` to be set and writable
- Requires source repository to be readable
- Directory structure is preserved but directory nesting depth is not limited
- Staging directory names are timestamped; cannot force specific names

---

## Relationships

### Called By
- User via `npm run kb:sync:obsidian` command
- [[kb-sync/kb-sync/run-all.sh|run-all.sh]] — master orchestrator (optional target)

### Calls / Depends On
- Obsidian vault directory (must exist and be writable)
- Source repository (must be readable)

### Related Concepts
- [[kb-sync/concepts/three-layer-vault-architecture|Three-Layer Vault Architecture]] — raw sources layer
- [[kb-sync/concepts/raw-source-staging|Raw Source Staging]] — immutable timestamped snapshots
- [[kb-sync/concepts/manifest-mode|Manifest Mode]] — safe ingest strategy using file manifest

### Participates In Workflows
- [[kb-sync/concepts/semantic-ingest-workflow|Semantic Ingest Workflow]] — Phase 1: staged sources

---

## Cross-References

### Bidirectional Links

- Related entities: [[kb-sync/kb-sync/run-all.sh|run-all.sh]]
- Related concepts: [[kb-sync/concepts/three-layer-vault-architecture|Three-Layer Vault Architecture]], [[kb-sync/concepts/raw-source-staging|Raw Source Staging]], [[kb-sync/concepts/manifest-mode|Manifest Mode]]
- Backlinks from: [[kb-sync/obsidian/index|obsidian module]]

---

## Source Citations

**Primary Source:** `modules/obsidian/ingest-obsidian.sh`  
**Configuration:** `configs/obsidian.yaml` (vault root, mapping rules)  
**Related:** `docs/targets/obsidian.md` (Obsidian vault schema)  
**Pack Reference:** `--- START FILE: modules/obsidian/ingest-obsidian.sh ---` to `--- END FILE: modules/obsidian/ingest-obsidian.sh ---`

---

## Implementation Notes

Staging directories are timestamped to enable multiple ingest runs over time. Each run creates a new timestamped directory, preserving all prior source versions. This allows wiki pages to retroactively cite specific source versions by absolute path: `_kb-sync-staging/repo/20260711-174821/path/to/file.ts`.

The manifest file (`FILES.manifest.txt`) lists all staged files with metadata (path, size, timestamp). This enables [[kb-sync/concepts/manifest-mode|Manifest Mode]] — a safe ingest strategy where Claude Code can verify against the manifest before synthesizing wiki content.

Raw sources are never directly linked from wiki pages; only the staging directory path is cited. This maintains separation of concerns and audit trail.
