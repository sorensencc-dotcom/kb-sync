# notebooklm Integration

**Category:** External Knowledge Base Sync  
**Last Updated:** 2026-07-11

## Entities

- [[notebooklm module]] — Google NotebookLM API integration layer
- [[ingest-notebooklm.sh]] — Automated ingestion script; purges old sources and uploads pack
- [[kb-sync-nightly.sh]] — Nightly scheduled sync task for CI/CD environments
- [[register-kb-sync-task.ps1]] — Windows task scheduler registration for automated runs

## Concepts

- [[Pack-Based Knowledge Management]] — Consolidated pack uploaded to NotebookLM
- [[Deterministic Sync Pipeline]] — 6-phase execution: Trigger → Flatten → Pack → Purge → Upload → Verify
- [[Fail-Soft Orchestration]] — Continues on individual target failures

## Module Purpose

The notebooklm module bridges the kb-sync system with Google NotebookLM, enabling agents and developers to query an up-to-date, version-controlled knowledge base. The sync pipeline programmatically purges old sources and uploads refreshed packs to keep MCP clients (Cursor, Claude, Windsurf) grounded with latest codebase context.

---

## See Also

- [[kb-sync Core Module]] — Master orchestration scripts
- [[obsidian module]] — Alternative vault staging target
- [[wiki module]] — Semantic synthesis layer
