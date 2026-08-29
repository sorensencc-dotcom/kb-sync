---
title: "WikiConceptsLocalContextCache"
category: "wiki"
status: "active"
citations: ["wiki/concepts/local-context-cache.md"]
sourceRepository: kb-sync
---

# WikiConceptsLocalContextCache

## Summary
Synthesized documentation node for the local SQLite context cache and MCP memory server.

## Architectural Overview
The Local SQLite Context Cache indexes markdown and JSON documentation into an embedded SQLite database (`knowledge.db`) using `fts5` full-text BM25 search. An MCP stdio server exposes `query_context_cache` and `fetch_topic_note` tools to interactive agents.

## Subsystems & References
- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]]
- [[kb-sync/concepts/trm-closed-loop-research|TRM Closed Loop Research]]

## Source Citations
- Staged: `wiki/concepts/local-context-cache.md`
