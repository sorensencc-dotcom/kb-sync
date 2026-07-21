---
title: "notebooklm Integration"
category: "wiki"
status: "active"
---

# notebooklm Integration

**Category:** External Knowledge Base Sync  
**Last Updated:** 2026-07-11

## Entities

- [[kb-sync/notebooklm/index|notebooklm module]] — Google NotebookLM API integration layer
- [[kb-sync/notebooklm/ingest-notebooklm.sh|ingest-notebooklm.sh]] — Automated ingestion script; purges old sources and uploads pack
- [[kb-sync/notebooklm/kb-sync-nightly.sh|kb-sync-nightly.sh]] — Nightly scheduled sync task for CI/CD environments
- [[kb-sync/notebooklm/register-kb-sync-task.ps1|register-kb-sync-task.ps1]] — Windows task scheduler registration for automated runs

## Concepts

- [[kb-sync/concepts/pack-based-knowledge-management|Pack-Based Knowledge Management]] — Consolidated pack uploaded to NotebookLM
- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]] — 6-phase execution: Trigger → Flatten → Pack → Purge → Upload → Verify
- [[kb-sync/concepts/fail-soft-orchestration|Fail-Soft Orchestration]] — Continues on individual target failures

## Module Purpose

The notebooklm module bridges the kb-sync system with Google NotebookLM, enabling agents and developers to query an up-to-date, version-controlled knowledge base. The sync pipeline programmatically purges old sources and uploads refreshed packs to keep MCP clients (Cursor, Claude, Windsurf) grounded with latest codebase context.

---

## See Also

- [[kb-sync/kb-sync/index|kb-sync Core Module]] — Master orchestration scripts
- [[kb-sync/obsidian/index|obsidian module]] — Alternative vault staging target
- [[kb-sync/wiki/index|wiki module]] — Semantic synthesis layer
