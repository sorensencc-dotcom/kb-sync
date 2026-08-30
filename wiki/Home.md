# KB-Sync Knowledge Base & Operational Wiki

Welcome to the canonical engineering, operational, and architectural documentation for **KB-Sync**.

KB-Sync is a deterministic, multi-channel knowledge synchronization and automated healing engine. It implements the Karpathy LLM-Wiki pattern across Obsidian local vaults, Google NotebookLM corpora, SQLite semantic vector caches, and remote GitHub Wikis.

---

## 🧭 Navigation & Knowledge Base Index

### 📐 Architecture & Core Principles
* [[deterministic-sync-pipeline]] — Strict SHA-256 state tracking, staged manifests, and immutable snapshotting.
* [[karpathy-llm-wiki-pattern]] — LLM-as-compiler distillation of raw source corpora into structured knowledge nodes.
* [[local-context-cache]] — Zero-cloud local SQLite context cache with BM25 full-text indexing and embeddings.
* [[fail-soft-orchestration]] — Tier 1/2/3 governance guardrails, boundary enforcement, and dirty-worktree protection.
* [[pack-based-knowledge-management]] — Packing and distribution formats for offline intelligence substrates.

### 🔬 Research RFCs & Gap Triage
* [[rfc-gap-01--cast-iron-charlie-research-lo]] — GAP-01: Research and chronological provenance extraction.
* [[rfc-gap-02--cast-iron-charlie-research-lo]] — GAP-02: Under-sourced claims and contradictory evidence analysis.
* [[rfc-gap-03--cast-iron-charlie-research-lo]] — GAP-03: Cuban land seizures and agricultural holdings claims.
* [[rfc-gap-04--cast-iron-charlie-research-lo]] — GAP-04: Photographic archive cataloging and verification.

### 🛠️ Modules & Engine Subsystems
* [[fleet-wiki-reconciler.ts]] — Multi-repository SSH wiki publisher and navigation engine.
* [[cross-repo-drift-scanner.ts]] — Zero-tolerance cross-repository drift detector and telemetry analyzer.
* [[autoheal-sweeper.mjs]] — Automated markdown healing sweeper with repair manifests and hash tracking.
* [[entity-synthesizer.ts]] — Automated AST and code entity documentation generator.
* [[detect-drift.ts]] — Local file modification, git commit date, and proof receipt validator.

---

## ⚡ Gap Triage & Closed-Loop Architecture

![KB-Sync TRM Gap Triage Architecture](trm-gap-triage-architecture.png)

---

## 🔒 Security & Governance Guarantees
- **Containment:** Edits strictly isolated to sandbox checkouts; `C:\dev` root treated as read-only.
- **Fail-Closed Drift Policy:** Non-clean telemetry or future clock skew rejects operations.
- **Cryptographic Receipts:** Every sync emits verifiable `.wiki-sync-receipt.json` records.
