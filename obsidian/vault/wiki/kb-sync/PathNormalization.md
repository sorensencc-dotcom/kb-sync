---
title: "Path Normalization"
category: "entity"
type: "infrastructure"
source_path: "_kb-sync-staging/kb-sync/20260725-213400"
last_ingest_date: "2026-07-25"
tags: ["cross-platform", "path-handling", "bash", "windows", "wsl"]
---

# Path Normalization

**Module:** `core/` cross-platform path utilities  
**Type:** Infrastructure Utility  
**Language:** Bash with Platform Detection  
**Version:** 1.0.0  

## Summary

Cross-platform path normalization system that transparently converts Windows paths (C:\...) to WSL mount format (/mnt/c/...) when running under Windows Subsystem for Linux, enabling seamless operation across Windows and Unix-like environments.

## Purpose

Provides platform-aware path conversion to handle kb-sync execution in hybrid Windows/WSL environments without requiring explicit path reformatting by operators.

## Key Operations

1. **Platform Detection** — Checks `/proc/version` for WSL environment
2. **Path Conversion** — Transforms `C:\path` → `/mnt/c/path`
3. **Drive Letter Normalization** — Converts uppercase drive letters to lowercase
4. **Backslash Handling** — Strips and converts backslashes to forward slashes
5. **Pass-Through** — Returns Unix paths unchanged

## Architecture

```bash
convert_to_wsl_path() {
  local path="$1"
  # Remove backslashes
  path="${path//\\//}"
  # Convert to /mnt/<drive>/ only if running under WSL
  if grep -qi microsoft /proc/version 2>/dev/null; then
    if [[ "$path" =~ ^([A-Za-z]):/(.*) ]]; then
      local drive="${BASH_REMATCH[1]}"
      local rest="${BASH_REMATCH[2]}"
      drive=$(echo "$drive" | tr '[:upper:]' '[:lower:]')
      path="/mnt/${drive}/${rest}"
    fi
  fi
  echo "$path"
}
```

## Configuration

Environment Variables:
- `OBSIDIAN_VAULT_ROOT` — Obsidian vault path (auto-converted)
- `WORKSPACE_TIMEOUT_MS` — Override timeout per environment

## Related Entities

- [[kb-sync/kb-sync/KBSyncOrchestration|KB-Sync Orchestration]] — Uses path normalization for config resolution

## Related Concepts

- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]] — Depends on reliable path handling

## Source References

- Raw source: `_kb-sync-staging/kb-sync/20260725-213400/modules/obsidian/ingest-obsidian.sh` (lines 122-137)
- Raw source: `_kb-sync-staging/kb-sync/20260725-213400/modules/notebooklm/ingest-notebooklm.sh` (path conversion logic)
- Tests: `_kb-sync-staging/kb-sync/20260725-213400/tests/path-normalizer-verification.ts`

---

**Last Synthesized:** 2026-07-25 21:34 UTC  
**Status:** Active  
**Maintenance Tier:** Core Infrastructure
