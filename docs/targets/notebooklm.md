---
title: "notebooklm"
category: "wiki"
status: "active"
---

# NotebookLM Target: Sync & Authentication

This document details target-specific mechanics for syncing to Google NotebookLM.

## Architecture

```
[Local Codebase] 
       │
       ├─> core/flatten.sh (pyragify or git-grep fallback)
       │
       ├─> core/validate.sh (size check: OK/WARN/HARD)
       │
       ├─> core/chunk.sh (if HARD: split into line-safe chunks)
       │
       ├─> core/rollback.sh (backup pre-purge snapshots)
       │
       └─> NotebookLM CLI (purge + upload)
               │
               ▼
       [NotebookLM API]
               │
               ▼
       [Claude Desktop / Cursor / Windsurf MCP Clients]
```

The pipeline provides NotebookLM with a fresh, consolidated knowledge base of the repository codebase, enabling MCP clients to query the latest source alongside agent execution.

## Execution Flow

### Trigger
```bash
npm run kb:sync
```
Calls `modules/notebooklm/ingest-notebooklm.sh`.

### Step 1: Flatten
Attempts `pyragify` (fast AST-based flattening); falls back to `git grep` manual flattener. Produces concatenated pack file (`repo_knowledge_pack.txt`) with `--- START FILE --- / --- END FILE ---` delimiters.

### Step 2: Validate
Checks pack size against thresholds from `configs/global.yaml`:
- OK: ≤ 5MB (warning_bytes)
- WARN: 5–8MB (hard_bytes) — acceptable, but alerts operator
- HARD: > 8MB — requires chunking

### Step 3: Chunk (if HARD)
Splits oversized pack using `split -C 4M` to maintain line boundaries. Produces `repo_knowledge_pack_part_aa.txt`, `repo_knowledge_pack_part_ab.txt`, etc.

### Step 4: Rollback Snapshot
Backs up all files (pack or chunks) as `*.bak.txt` before purge. Enables recovery if something breaks.

### Step 5: Purge & Upload
Invokes `notebooklm-mcp` CLI:
```bash
notebooklm-mcp sources delete --notebook "$NOTEBOOK_ID" --all
notebooklm-mcp sources add --notebook "$NOTEBOOK_ID" <file>  # per chunk or single pack
```

### Step 6: Verify
Logs success confirmation. If any step fails, exits with code 1.

## Authentication

### Required Environment Variables

Set in local, git-ignored `.env` file:
```ini
NOTEBOOK_ID="your-notebook-id-here"
NOTEBOOKLM_COOKIE="session=..."
```

### Extracting Credentials

NotebookLM lacks an official public API; CLI tools mimic browser sessions.

**To get NOTEBOOK_ID**:
1. Open `notebooklm.google.com` in browser.
2. Select your target notebook.
3. URL will be `https://notebooklm.google.com/notebook/<id>`.
4. Copy the `<id>` part.

**To get NOTEBOOKLM_COOKIE**:
1. Log in to `notebooklm.google.com`.
2. Open Browser DevTools (F12) → Application/Storage → Cookies.
3. Find session cookies: `__Secure-3PAPISID`, `__Secure-3PSID`, or equivalent.
4. Copy the full cookie string.
5. Paste into `.env` as `NOTEBOOKLM_COOKIE="<full-string>"`.

### Security

- **Zero-Commit**: Never commit `.env` to git. It's in `.gitignore` by default.
- **Vault Sourcing**: In CI/CD, populate credentials from your secret management system (Vault, GitHub Secrets, etc.).
- **Rotation**: Cookies expire after ~30 days or manual logout. Refresh using steps above if auth fails.

## Error Handling

### Missing Credentials
```
[NLM-INGEST] [ERROR] Missing environment credentials.
```
Create `.env` with valid `NOTEBOOK_ID` and `NOTEBOOKLM_COOKIE`.

### Missing Notebook ID
```
[NLM-INGEST] [ERROR] NOTEBOOK_ID environment variable is missing.
```
Extract NOTEBOOK_ID from NotebookLM URL and add to `.env`.

### CLI Not Installed
```
[NLM-INGEST] [WARN] CLI tool 'notebooklm-mcp' not installed.
[NLM-INGEST] [INFO] Skipping programmatic purge/upload.
```
Script degrades gracefully. Manual workaround:
- Install `notebooklm-mcp` CLI.
- Or manually upload `.nlm_pack/repo_knowledge_pack.txt` via NotebookLM Web UI.

### pyragify Failures
```
[FLATTEN] [INFO] pyragify failed... Falling back to manual git flattener.
```
Script automatically uses `git grep` fallback. Check your Python environment if you want pyragify to work.

### Size Exceeded
```
[VALIDATE] [WARN] Pack file size exceeds hard limit. Chunking required before upload.
[NLM-INGEST] [INFO] Codebase chunked into 4 parts.
```
Automatic chunking. Monitor chunk count; if > 50 chunks, consider limiting include_extensions.

### API Rate Limits
```
[NLM-INGEST] [ERROR] notebooklm-mcp command failed (exit code: 429)
```
Google rate limits or network timeout. Wait for rate window to reset or restore connectivity. Retry manually:
```bash
npm run kb:sync
```

## Rollback

If a sync corrupts NotebookLM state (bad citations, outdated code), restore the previous working version:
```bash
npm run kb:sync:rollback
```

This:
1. Looks up `.bak.txt` snapshots from the previous sync.
2. Restores backup files to pack location.
3. Purges current notebook sources.
4. Re-uploads the backup files.

## Configuration

### configs/notebooklm.yaml
```yaml
output_dir: "./.nlm_pack"
pack_filename: "repo_knowledge_pack"
include_extensions: [.ts, .js, .py, .md, .json, .yaml, .yml, .sh, .ps1]
```

### configs/global.yaml
```yaml
warning_bytes: 5000000    # 5MB — warn if pack approaches
hard_bytes: 8000000       # 8MB — require chunking if exceeded
chunk_size: 4M            # split -C parameter for line-safe chunks
skip_patterns:            # glob patterns to exclude
  - "*.png"
  - "*node_modules/*"
  - "...etc"
```

## Troubleshooting

**Q: Sync hangs or times out.**
A: Check network connectivity. Review `.nlm_pack/sync-background.log` if running as post-commit hook (background). Increase timeout or retry manually.

**Q: Pack size keeps growing; NotebookLM slows down.**
A: Tighten `include_extensions` in `configs/notebooklm.yaml` or add more patterns to `skip_patterns` in `configs/global.yaml`. Example: exclude `dist/` or `*.test.ts`.

**Q: After sync, Claude still sees old code in NotebookLM.**
A: NotebookLM caches embeddings. Wait 1–2 minutes for index refresh. If persists, run `npm run kb:sync:rollback` then `npm run kb:sync` to force re-index.

## See Also
- [Obsidian Target](./obsidian.md)
- [Pipeline Architecture](../kb/notebooklm-sync/architecture.md)
- [Operator Rules](../kb/notebooklm-sync/operator-rules.md)
