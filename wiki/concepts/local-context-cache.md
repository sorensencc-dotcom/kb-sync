---
title: Local Context Cache
category: concepts
status: active
sourceRepository: kb-sync
lastUpdated: "2026-08-30"
---

# Local Context Cache

The **Local Context Cache** is a zero-cloud, embedded SQLite knowledge engine (`knowledge.db`) providing ultra-fast semantic and full-text retrieval across all repository documents and entity specifications.

---

## 🏛️ Architectural Overview

The Local Context Cache indexes markdown and JSON documentation into an embedded SQLite database using `fts5` full-text BM25 search. An MCP stdio server exposes `query_context_cache` and `fetch_topic_note` tools to interactive agents.

```mermaid
flowchart LR
    classDef clientStyle fill:#1e293b,stroke:#64748b,stroke-width:2px,color:#f8fafc;
    classDef engineStyle fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef dbStyle fill:#1e1b4b,stroke:#818cf8,stroke-width:2px,color:#f8fafc;

    AGENT["AI Coding Agent / Subagent"]:::clientStyle
    MCP["MCP Memory Server (stdio)"]:::engineStyle
    SQLITE[("SQLite Database (fts5 + BM25)")]:::dbStyle

    AGENT -->|query_context_cache| MCP
    MCP <--> SQLITE
```

---

## 🛠️ MCP Tool Interface

- `query_context_cache(query: string, limit?: number)`: Executes ranked BM25 queries across all indexed topic nodes.
- `fetch_topic_note(topic_id: string)`: Retrieves the complete markdown content and citation metadata for a specific topic note.

---

## 🔗 Related Concepts
- [[deterministic-sync-pipeline]] — Deterministic sync pipeline
- [[trm-closed-loop-research]] — TRM closed-loop research
