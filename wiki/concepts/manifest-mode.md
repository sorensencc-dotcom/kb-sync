---
type: concept
tags: [manifest, packing, nlm]
created: 2026-08-01
---

# Manifest Mode

**Manifest Mode** is an ingestion strategy in `core/flatten.sh` where source repository files are listed into `manifest.txt` with SHA256 checksums and relative file paths before consolidation into `.nlm_pack/`.

## Key Capabilities

- **Path Preservation**: Retains exact relative paths across multi-file repositories.
- **Hash Integrity**: Provides checksum validation during pack consolidation.
- **Config-Driven Inclusions**: Adheres to `pyragify.yaml` rules.

## Related Entities & Concepts

- [[flatten.sh]]
- [[pack-based-knowledge-management]]
