# ingest-notebooklm.sh

**Type:** Script  
**Location:** `modules/notebooklm/ingest-notebooklm.sh`  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Summary

NotebookLM ingestion script that orchestrates the six-phase sync pipeline: Trigger → Flatten → Pack → Purge → Upload → Verify. Programmatically communicates with the NotebookLM API via the `notebooklm-mcp` CLI tool.

The script purges all existing sources from the target notebook, uploads the fresh pack (chunked if necessary), and verifies successful completion. Keeps MCP clients (Cursor, Claude, Windsurf) grounded with latest codebase context.

---

## Attributes

### Input
- `.nlm_pack/repo_knowledge_pack.txt` (or chunked parts) — consolidated knowledge pack
- Environment variables: `NOTEBOOK_ID`, credentials (from `.env`)
- `notebooklm-mcp` CLI tool (must be installed and in `$PATH`)

### Output
- Synced state in NotebookLM: sources purged and replaced with fresh pack
- `.nlm_pack/*.bak.txt` — backup for rollback
- Exit code: 0 (success), 1 (API error or validation failure)

### Side Effects
- Purges all existing sources in target notebook (irreversible, use [[rollback.sh]] to restore)
- Uploads new sources to NotebookLM API
- Creates backup files for rollback

### Performance Characteristics
- Runtime: 30–60 seconds (depends on pack size and API latency)
- Network-bound (API calls to NotebookLM)
- Scales linearly with pack size and network latency

### Constraints & Limits
- Requires valid `NOTEBOOK_ID` and API credentials in `.env`
- Requires `notebooklm-mcp` to be installed and executable
- Pack size limited to 8 MB per source (script chunks if needed)
- Cannot run if NotebookLM API is unavailable

---

## Relationships

### Called By
- [[run-all.sh]] — master orchestrator
- `npm run kb:sync` command
- CI/CD pipelines
- Post-commit hooks (optional)

### Calls / Depends On
- `notebooklm-mcp` CLI (external MCP client)
- `.env` file (credentials)
- [[chunk.sh]] (for size management, if needed)

### Related Concepts
- [[Deterministic Sync Pipeline]] — implements NotebookLM-specific phases
- [[Pack-Based Knowledge Management]] — uploads consolidated pack
- [[Fail-Soft Orchestration]] — continues despite per-target failures

### Participates In Workflows
- [[Deterministic Sync Pipeline]]

---

## Cross-References

### Bidirectional Links

- Related entities: [[run-all.sh]], [[chunk.sh]], [[kb-sync-nightly.sh]]
- Related concepts: [[Deterministic Sync Pipeline]], [[Pack-Based Knowledge Management]]
- Backlinks from: [[notebooklm module]]

---

## Source Citations

**Primary Source:** `modules/notebooklm/ingest-notebooklm.sh`  
**Related:** NotebookLM MCP (`notebooklm-mcp` CLI)  
**Configuration:** `.env` (notebook ID, credentials)  
**Pack Reference:** `--- START FILE: modules/notebooklm/ingest-notebooklm.sh ---` to `--- END FILE: modules/notebooklm/ingest-notebooklm.sh ---`

---

## Implementation Notes

The script uses the `notebooklm-mcp sources delete --notebook "$NOTEBOOK_ID" --all` command to purge old sources before uploading new ones. This prevents stale citations and conflicting source references. The purge-then-upload sequence ensures consistency.

If pack size exceeds 5 MB, the script logs a warning; if it exceeds 8 MB, it invokes [[chunk.sh]] to split the pack and upload chunks individually.

Backup creation is deferred until successful upload, ensuring only known-good packs are backed up.
