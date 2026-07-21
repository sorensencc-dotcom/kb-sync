# ingest-obsidian.sh

**Type**: Obsidian Sync Module Script  
**Location**: `modules/obsidian/ingest-obsidian.sh`  
**Purpose**: Stage raw repository sources into Obsidian vault for human-driven wiki synthesis

---

## Summary

Orchestrates the Karpathy LLM-wiki pattern for Obsidian: stages raw sources into an immutable, timestamped directory and generates a manifest. No automatic wiki updates; human-in-the-loop synthesis via Claude or manual curation follows staging.

---

## Scope

- Calls `core/flatten.sh` with `--manifest` mode to generate file list
- Copies files from repository into `vault_root/_kb-sync-staging/<repo>/<timestamp>/`
- Preserves directory structure (e.g., `src/modules/foo.ts` → `staging/.../src/modules/foo.ts`)
- Generates manifest (`FILES.manifest.txt`) for reference
- Supports configurable vault root via `OBSIDIAN_VAULT_ROOT` env var or `vault_root` in `configs/obsidian.yaml`

---

## Key Operations

| Operation | Command | Result |
|-----------|---------|--------|
| Stage sources | `./modules/obsidian/ingest-obsidian.sh` | Timestamped staging directory created |
| Check vault config | Set `OBSIDIAN_VAULT_ROOT` or edit `obsidian.yaml` | Vault root resolved |

---

## Parameters

- `OBSIDIAN_VAULT_ROOT` (env var) — Override vault root (optional)
- Reads `configs/obsidian.yaml` — Default vault_root, staging_dir, wiki_dir

---

## Calls

- `core/flatten.sh --manifest` — Generates file manifest
- `mkdir`, `cp` — Directory and file operations (standard Unix)

---

## Side Effects

- Creates staging directory: `vault_root/_kb-sync-staging/kb-sync/YYYYMMDD-HHMMSS/`
- Copies all staged files verbatim (preserves permissions where possible)
- Generates `FILES.manifest.txt` in staging root
- Logs to stderr with colored output

---

## Failure Modes

| Condition | Behavior | Recovery |
|-----------|----------|----------|
| Vault root not set | Skips staging (fail-soft) | Set `OBSIDIAN_VAULT_ROOT` env var |
| Vault directory missing | Logs warning, exits cleanly | Create vault root directory |
| File copy fails | Logs warning per file, continues | Check source file permissions |

---

## Dependencies

- Bash 4.0+
- Git CLI (via flatten.sh)
- Standard Unix: cp, mkdir, date
- `core/flatten.sh` script

---

## Metadata

- **Source Version**: Stage hash TBD  
- **Last Ingest**: 2026-07-20  
- **Related Entities**: [[run-all.sh]], [[flatten.sh]], [[ingest-wiki.sh]]  
- **Related Concepts**: [[raw-source-staging]], [[karpathy-llm-wiki-pattern]], [[immutable-staging]]

---

## Raw Source

**File**: `modules/obsidian/ingest-obsidian.sh`  
**Staged**: `_kb-sync-staging/kb-sync/20260720-003223/modules/obsidian/ingest-obsidian.sh`  
**Availability**: Immutable reference in staging layer.
