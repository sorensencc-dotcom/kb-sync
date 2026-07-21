---
title: "pipeline"
category: "wiki"
status: "active"
---

# NotebookLM Sync Pipeline: Ingestion Loop

This document outlines the sequential, deterministic steps performed during the sync execution pipeline.

## Execution Sequence

The sync pipeline consists of six sequential phases:

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ 1. Trigger  │ ──> │  2. Flatten  │ ──> │   3. Pack   │
└─────────────┘     └──────────────┘     └─────────────┘
                                                │
                                                ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  6. Verify  │ <── │  5. Upload   │ <── │  4. Purge   │
└─────────────┘     └──────────────┘     └─────────────┘
```

### 1. Trigger
The process is explicitly initiated by executing:
```bash
npm run kb:sync
```
This script calls `scripts/notebooklm/ingest-notebooklm.sh` and does not run in the background unless configured as an opt-in Git post-commit hook.

### 2. Flatten
The script attempts to execute `pyragify` using `uv run` to scan the repository, parse the AST/text structure, and apply exclusions defined in `pyragify.yaml`.

### 3. Pack
The script compiles the extracted codebase files into a single consolidated file `repo_knowledge_pack.txt` inside `.nlm_pack/`. Each file is enclosed in a standard separator:
```text
--- START FILE: path/to/file.ts ---
[File Contents]
--- END FILE: path/to/file.ts ---
```

### 4. Purge
The script issues a command to the `notebooklm-mcp` CLI tool to delete all existing sources associated with the target notebook:
```bash
notebooklm-mcp sources delete --notebook "$NOTEBOOK_ID" --all
```
This prevents old code citations from conflicting with the updated codebase.

### 5. Upload
The new pack is programmatically uploaded as a single unified text source. If the pack exceeds size limits (5MB warning, 8MB hard limit), it is split into line-safe chunks (e.g. `repo_knowledge_pack_part_aa.txt`, `repo_knowledge_pack_part_ab.txt`) which are uploaded individually:
```bash
notebooklm-mcp sources add --notebook "$NOTEBOOK_ID" "$file"
```

### 6. Verify
The script validates the final upload status code, caches a local backup of the uploaded pack at `.nlm_pack/*.bak.txt` for rollback, and prints a success confirmation log message.

## See Also
- [Sync Architecture](./architecture.md)
- [Operator Rules](./operator-rules.md)
- [Authentication Config](./authentication.md)
