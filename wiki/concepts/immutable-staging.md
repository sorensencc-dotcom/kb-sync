# Immutable Staging

**Type**: System Architecture Pattern  
**Domain**: kb-sync data management  
**Status**: Active

---

## Problem

When syncing an external repository into a knowledge base at multiple points in time, how do you preserve historical context?

**Naive approach**: Overwrite staging directory on each sync. Result: Can't see what changed; can't trace back to old source versions.

**kb-sync approach**: Each sync creates a new, timestamped staging directory. All previous stagings remain intact and immutable.

---

## Solution

### Architecture

**Staging Directory Structure**:
```
vault_root/
  _kb-sync-staging/
    kb-sync/
      20260719-233305/  ← First run (July 19, 23:33:05)
        [all raw files]
        FILES.manifest.txt
      20260720-003223/  ← Second run (July 20, 00:32:23)
        [all raw files]
        FILES.manifest.txt
```

Each staging is timestamped with format `YYYYMMDD-HHMMSS` (UTC).

### Key Properties

1. **Immutable**: Once created, staging directory is never edited
2. **Traceable**: Each staging includes a manifest file listing all sources
3. **Versioned**: Multiple stagings coexist; wikis can reference any version
4. **Auditable**: Operator can compare old vs. new staging to understand what changed

### Usage in Wiki

When creating entity pages, citation includes staging path:

```markdown
**Raw Source**

**File**: `core/flatten.sh`  
**Staged**: `_kb-sync-staging/kb-sync/20260720-003223/core/flatten.sh`  
**Availability**: Immutable reference in staging layer.
```

If the source is later updated and re-staged, the wiki can retroactively point to the old version that informed the original entity page.

---

## Examples

**Scenario**: Source file `core/flatten.sh` is modified in the origin repo.

1. **Old staging** (`20260720-003223`): Contains the previous version of `flatten.sh`
2. **New staging** (`20260720-120000`): Contains the updated version
3. **Wiki page** for `flatten.sh`: References the old staging; still accurate
4. **Audit trail**: Manifest files show exactly which files were in each staging

**Update process**: If the wiki needs to reflect the new version, a new entity synthesis run updates the page and cites the new staging path.

---

## Benefits

- **Historical tracking**: Can show what the code looked like at ingest time
- **Reproducibility**: Staging can be re-synthesized from historical version
- **Safety**: Old stagings are never deleted; can always revert
- **Debugging**: If a synthesis was incorrect, can trace back to source version

---

## Related Concepts

- [[pack-based-knowledge-management]] — Packs are generated from staging sources
- [[deterministic-sync-pipeline]] — Staging is part of the deterministic pipeline
- [[raw-source-staging]] — Staging is the immutable raw layer

---

## Related Entities

- [[ingest-obsidian.sh]] — Creates new stagings with timestamps

---

## Retention Policy

**Current**: All stagings retained indefinitely  
**Future enhancement**: Configurable retention (e.g., keep last N stagings, delete older than T days)

---

## Metadata

- **Introduced**: kb-sync v1.0  
- **Pattern**: Write-once append-only (WORM) filesystem semantics  
- **Ingest Date**: 2026-07-20  
- **Last Updated**: [TBD]
