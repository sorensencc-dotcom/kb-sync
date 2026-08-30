---
title: TRM Closed-Loop Research
category: concepts
status: active
sourceRepository: kb-sync
lastUpdated: "2026-08-30"
---

# TRM Closed-Loop Research

**TRM Closed-Loop Research** is the autonomous gap detection, triage, and RFC materialization workflow connecting **TRM** and **KB-Sync**.

---

## 🔄 The Closed-Loop Lifecycle

```mermaid
flowchart TD
    classDef gapStyle fill:#7f1d1d,stroke:#f87171,stroke-width:2px,color:#f8fafc;
    classDef triageStyle fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef rfcStyle fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#f8fafc;

    GAPS["1. Gap Detection<br/>(NotebookLM Question Mining)"]:::gapStyle
    TRIAGE["2. Automated Gap Triage Engine<br/>(Context Cache & BM25 Cross-Referencing)"]:::triageStyle
    RFC["3. RFC Synthesis & Materialization<br/>(wiki/research/rfc-gap-*.md)"]:::rfcStyle
    SYNC["4. Knowledge Base & Wiki Publication<br/>(Home.md & Remote GitHub Wiki)"]:::rfcStyle

    GAPS --> TRIAGE
    TRIAGE --> RFC
    RFC --> SYNC
```

---

## 🛠️ Automated Triage Mechanics

1. **Gap Ingestion:** `trm-research-gaps.md` records surfaced historical or factual ambiguities.
2. **Context Cross-Referencing:** The triage engine queries `knowledge.db` to locate matching primary sources.
3. **RFC Generation:** Drafts structured decision RFCs with citation tables and open research questions.
4. **Approval Materialization:** Approved RFCs are incorporated into the canonical knowledge pack.

---

## 🔗 Related Concepts
- [[local-context-cache]] — Embedded context retrieval
- [[pack-based-knowledge-management]] — Knowledge pack structure
