---
title: "TRM Closed Loop Research"
category: "wiki"
status: "active"
---

# TRM Closed Loop Research

**Type:** Architecture, Research Pipeline  
**Domain:** kb-sync, knowledge-management, trm  
**Status:** Active  
**Last Updated:** 2026-08-21

---

## Definition

The Topic Research Matrix (TRM) closed-loop research pipeline provides deterministic ingestion, semantic validation, and automated knowledge synthesis for research artifacts. The system verifies SHA-256 digests, prevents path traversal attacks, and syncs synthesized markdown documents into both human-readable Obsidian vaults and an embedded SQLite full-text index for agent retrieval.

---

## Architecture and Lifecycle

1. **Staging**: Research batches land in `_kb-sync-staging/trm/` with explicit manifests and hash catalogs.
2. **Semantic validation**: `validateTrmPayloadSemantics` verifies content checksums, catches missing or orphan files, and checks path safety.
3. **Synthesis**: `synthesize-wiki.ts` compiles research findings into canonical wiki concepts and entity pages.
4. **Context caching**: `sync-cache.mjs` executes incremental upserts into `.kb_cache/knowledge.db` (SQLite FTS5).
5. **Agent access**: `mcp-memory-server.mjs` provides sub-millisecond retrieval via MCP tools `query_context_cache` and `fetch_topic_note`.

---

## Related Concepts

- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]] — underlying execution model
- [[kb-sync/concepts/local-context-cache|Local SQLite Context Cache]] — fast agent retrieval store
- [[kb-sync/concepts/immutable-staging|Immutable Staging]] — integrity enforcement
