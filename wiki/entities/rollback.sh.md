---
type: entity
tags: [core, rollback, recovery]
created: 2026-08-01
---

# `rollback.sh`

`core/rollback.sh` provides emergency rollback mechanisms for `kb-sync` target modules (`--rollback`), restoring previous staging directories and `.nlm_pack/` backups.

## Key Functions

- **Staging Reversion**: Restores `.nlm_pack.backup.*` directories.
- **Fail-Soft Recovery**: Ensures corrupted sync passes can be cleanly unwound.

## Related Scripts

- [[run-all.sh]]
- [[ingest-notebooklm.sh]]
