---
title: Pack-Based Knowledge Management
category: concepts
status: active
sourceRepository: kb-sync
lastUpdated: "2026-08-30"
---

# Pack-Based Knowledge Management

Pack-Based Knowledge Management is the foundational distribution and encapsulation model used across the **KB-Sync** and **Cast Iron Charlie** ecosystems. It packages heterogeneous raw research documents, transcripts, schema definitions, and vector embeddings into self-contained, offline-first knowledge packs (`.nlm_pack/`, `topic.pack.v1`).

---

## 📐 Core Architecture & Pack Lifecycle

A Knowledge Pack is a hermetic directory or bundle that packages source documents along with structural metadata, audit rules, and task specifications.

```mermaid
flowchart TD
    classDef rawStyle fill:#1e293b,stroke:#64748b,stroke-width:2px,color:#f8fafc;
    classDef packStyle fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef targetStyle fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#f8fafc;

    subgraph Inputs["1. Raw Multi-Source Ingestion"]
        RAW_DOCS["PDFs, Audio, Transcripts, Web Extracts"]:::rawStyle
        SRC_REG["Source Registry & SHA-256 Hashes"]:::rawStyle
        RAW_DOCS --> SRC_REG
    end

    subgraph Packaging["2. Pack Generation (topic.pack.v1)"]
        MANIFEST["topic.manifest.json<br/>(Domain, Version, Schema)"]:::packStyle
        TASKS["specs/task-*.json<br/>(research.task.v1)"]:::packStyle
        AUDIT["config/audit_rules.json<br/>(Temporal Bounds & Assertions)"]:::packStyle
        CATALOG["corpus/source_catalog.json<br/>(Immutable Hashes)"]:::packStyle
        
        SRC_REG --> MANIFEST
        MANIFEST --> TASKS
        MANIFEST --> AUDIT
        MANIFEST --> CATALOG
    end

    subgraph Distribution["3. Target Distribution & Synthesis"]
        NOTEBOOKLM["Google NotebookLM Ingestion (.nlm_pack)"]:::targetStyle
        OBSIDIAN["Obsidian Markdown Vault"]:::targetStyle
        SQLITE_VEC["Local SQLite Context Cache (BM25 + Vec)"]:::targetStyle
        WIKI["Remote GitHub Documentation Wiki"]:::targetStyle

        Packaging --> NOTEBOOKLM
        Packaging --> OBSIDIAN
        Packaging --> SQLITE_VEC
        Packaging --> WIKI
    end
```

---

## 📦 Key Pack Specifications

### 1. `topic.manifest.json`
Declares the root identity, parent-child topic hierarchy, and version contract:
```json
{
  "schema": "topic.pack.v1",
  "slug": "cuba-expropriations",
  "title": "Cuban Land Seizures & Agricultural Holdings",
  "version": "1.0.0",
  "domain": "cast-iron-charlie",
  "created_at": "2026-08-30T00:00:00Z"
}
```

### 2. `specs/task-*.json` (`research.task.v1`)
Atomic work items dispatched to local and remote extraction models. Each task locks its input evidence, required entity extractions, and temporal validation constraints.

### 3. `corpus/source_catalog.json`
Cryptographic catalog of all raw documents in the pack, recording:
- Original URI / provenance
- Local relative storage path
- File size and MIME type
- SHA-256 content digest

---

## ⚡ Operational Advantages

1. **Hermetic Reproducibility:** Every extraction, summary, or gap triage finding can be traced back to the exact byte-level SHA-256 hash of its source document in the pack.
2. **Offline-First Resilience:** Knowledge packs can be synced, queried, and verified without external network access.
3. **Multi-Target Portability:** A single pack compiles into Obsidian Markdown nodes, NotebookLM upload packages, SQLite vector stores, or GitHub Wiki pages.

---

## 🔗 Related Concepts
- [[deterministic-sync-pipeline]] — Strict SHA-256 state tracking and staging
- [[karpathy-llm-wiki-pattern]] — LLM distillation of raw pack sources
- [[local-context-cache]] — Zero-cloud local embedding substrate
