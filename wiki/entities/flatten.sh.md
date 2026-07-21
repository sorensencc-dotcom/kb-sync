# flatten.sh

**Type**: Core Utility Script  
**Location**: `core/flatten.sh`  
**Purpose**: Generate file manifests and concatenate sources into knowledge packs

---

## Summary

Flattens repository into a single knowledge pack or generates a newline-delimited file manifest. Implements selective file inclusion, glob pattern exclusion, and optional manifest-only mode for staged source discovery.

---

## Scope

- Recursively traverses repository structure
- Applies `skip_patterns` from `configs/global.yaml`
- Optional file extension filtering (via `include_extensions`)
- Outputs either:
  - **Pack mode** (default): Concatenated pack with file delimiters
  - **Manifest mode** (`--manifest`): Newline-delimited file list only

---

## Key Operations

| Operation | Command | Output |
|-----------|---------|--------|
| Generate pack | `./flatten.sh --output DIR --pack-name NAME` | `.txt` file with delimiters |
| Generate manifest | `./flatten.sh --manifest --output DIR --pack-name NAME` | `pack.manifest.txt` |

---

## Parameters

- `--output DIR` — Output directory (required)
- `--pack-name NAME` — Pack filename prefix (required)
- `--global-config PATH` — Path to global.yaml (auto-discovered if omitted)
- `--repo-root PATH` — Repository root (auto-discovered via git if omitted)
- `--manifest` — Manifest-only mode (skip pack generation)

---

## Calls

- `configs/global.yaml` — Reads skip patterns and configuration
- Git CLI (`git rev-parse`, `git ls-files`) — Directory traversal and version info

---

## Side Effects

- Creates output directory if missing
- Writes pack file or manifest to output directory
- Logs processing details to stderr

---

## Dependencies

- Bash 4.0+
- Git CLI (for repo root detection and file traversal)
- Standard Unix tools: grep, sed, find

---

## Metadata

- **Source Version**: Stage hash TBD  
- **Last Ingest**: [Awaiting first synthesis]  
- **Related Entities**: [[run-all.sh]], [[chunk.sh]], [[validate.sh]]  
- **Related Concepts**: [[pack-based-knowledge-management]], [[immutable-staging]]

---

## Raw Source

**File**: `core/flatten.sh`  
**Staged**: `_kb-sync-staging/kb-sync/20260720-003223/core/flatten.sh`  
**Availability**: Immutable reference in staging layer.
