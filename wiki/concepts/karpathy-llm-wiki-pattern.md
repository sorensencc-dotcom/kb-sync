---
title: Karpathy LLM-Wiki Pattern
category: concepts
status: active
sourceRepository: kb-sync
lastUpdated: "2026-08-30"
---

# Karpathy LLM-Wiki Pattern

The **Karpathy LLM-Wiki Pattern** models knowledge distillation as a compilation pipeline where **raw, noisy source corpora are compiled by LLMs into structured, interconnected markdown wiki nodes**.

---

## 📐 The Compilation Model

```mermaid
flowchart TD
    classDef rawStyle fill:#1e293b,stroke:#64748b,stroke-width:2px,color:#f8fafc;
    classDef llmStyle fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef wikiStyle fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#f8fafc;

    RAW["Raw Source Corpora<br/>(Transcripts, Code, RFCs, Papers)"]:::rawStyle
    
    COMPILER["LLM as Compiler<br/>(Local / Claude / Ollama)"]:::llmStyle
    
    subgraph Target["Structured Markdown Wiki"]
        direction TB
        ENTITIES["Entities<br/>(API signatures, exports, metrics)"]:::wikiStyle
        CONCEPTS["Concepts<br/>(High-level architecture, trade-offs)"]:::wikiStyle
        INDEX["Navigation & Graph<br/>(Home.md, _Sidebar.md, [[Wikilinks]])"]:::wikiStyle
    end

    RAW --> COMPILER
    COMPILER --> Target
```

---

## 🔑 Key Tenets

1. **Source Documents are Immutable:** Raw inputs are never edited; they are analyzed and cited.
2. **Wiki Pages are Living Compilations:** When source files change, the corresponding wiki nodes are re-synthesized or patched.
3. **Hyperlinked Semantic Web:** Concepts and entities reference each other via `[[Wikilinks]]`, creating an interconnected knowledge graph.
4. **Automated Auditability:** Every synthesized page carries a frontmatter contract with citations and source SHA-256 hashes.

---

## 🔗 Related Concepts
- [[pack-based-knowledge-management]] — Packaging source inputs
- [[local-context-cache]] — Zero-cloud local embedding substrate
- [[trm-closed-loop-research]] — Closed-loop research gap resolution
