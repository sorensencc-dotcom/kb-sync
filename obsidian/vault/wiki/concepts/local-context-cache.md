---
title: "Local SQLite Context Cache"
category: "wiki"
status: "active"
---

# Local SQLite Context Cache

**Type:** Architecture, MCP Server  
**Domain:** kb-sync, agent-tooling, search  
**Status:** Active  
**Last Updated:** 2026-08-21

---

## Definition

The Local SQLite Context Cache is an embedded search and retrieval service that indexes local knowledge base pages into `.kb_cache/knowledge.db` using SQLite `fts5`. It powers zero-network lexical BM25 search for interactive coding agents through a Model Context Protocol (MCP) stdio server.

---

## Technical Specifications

- **Engine**: SQLite 3 with `fts5` virtual table (`porter unicode61` tokenizer)
- **Synchronization**: Automated SQLite database triggers (`trg_kb_docs_ai`, `trg_kb_docs_au`, `trg_kb_docs_ad`)
- **MCP Server Tools**:
  - `query_context_cache`: BM25 lexical keyword ranking and context snippets
  - `fetch_topic_note`: Topic slug lookup and complete markdown retrieval

---

## Related Concepts

- [[kb-sync/concepts/trm-closed-loop-research|TRM Closed Loop Research]] — primary research synthesis source
- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]] — orchestrating pipeline
