---
title: Deterministic Sync Pipeline
category: concepts
status: active
sourceRepository: kb-sync
lastUpdated: "2026-08-30"
---

# Deterministic Sync Pipeline

The **Deterministic Sync Pipeline** is the core state management and publication protocol of **KB-Sync**. It ensures that all synchronizations between local checkouts, Obsidian vaults, NotebookLM, and remote GitHub Wikis are repeatable, idempotent, and backed by cryptographic verification receipts.

---

## 📐 Pipeline Stages & Invariants

```mermaid
flowchart LR
    classDef stageStyle fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef gateStyle fill:#1e1b4b,stroke:#818cf8,stroke-width:2px,color:#f8fafc;
    classDef outStyle fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#f8fafc;

    S1["1. Drift & Clock-Skew Detection"]:::stageStyle --> G1{"Clean Worktree & Time Valid?"}:::gateStyle
    G1 -- Yes --> S2["2. Immutable Staging Snapshot"]:::stageStyle
    G1 -- No (Block) --> FAIL["Halt with Exit 1"]
    
    S2 --> S3["3. Entity & Schema Synthesis"]:::stageStyle
    S3 --> S4["4. Navigation & Layout Generation"]:::stageStyle
    S4 --> S5["5. Atomic Push & Receipt Emission"]:::outStyle
```

---

## 🔒 The Five Determinism Guarantees

1. **Strict Timestamp Validation:**
   Timestamps must follow ISO-8601 UTC format. Any report or manifest with a future timestamp exceeding a 60-second threshold is rejected immediately as clock-skew.
2. **Worktree Cleanliness Guard:**
   Mutating operations require a clean Git working tree. Untracked and uncommitted files block automatic healing runs to prevent silent overwrites.
3. **Idempotent Manifest Hashing:**
   Staging directories are identified by SHA-256 manifest hashes. If a manifest hash has already been processed in `Log.md`, repeat runs are skipped unless `--force` is provided.
4. **Canonical Path Containment:**
   All read and write operations are strictly contained within verified repository roots, blocking directory traversal (`..`) and sandbox leakage.
5. **Cryptographic Proof Receipts (`.wiki-sync-receipt.json`):**
   Every publication emits a verifiable receipt recording local commit HEAD, remote wiki HEAD, timestamp, and published file counts.

---

## 🔗 Related Concepts
- [[pack-based-knowledge-management]] — Hermetic knowledge packaging
- [[fail-soft-orchestration]] — Tiered governance and safety gates
- [[immutable-staging]] — Staging directory contracts
