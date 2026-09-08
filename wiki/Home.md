---
title: Home
category: wiki
status: draft
sourceRepository: kb-sync
---
# KB-Sync Knowledge Base & Operational Wiki

Welcome to the canonical engineering, operational, and architectural documentation for **KB-Sync**.

KB-Sync is a deterministic, multi-channel knowledge synchronization and automated healing engine. It implements the Karpathy LLM-Wiki pattern across Obsidian local vaults, Google NotebookLM corpora, SQLite semantic vector caches, and remote GitHub Wikis.

---

## 🧭 Navigation & Knowledge Base Index

### 📐 Architecture & Core Principles
* [[concepts/deterministic-sync-pipeline.md]] — Strict SHA-256 state tracking, staged manifests, and immutable snapshotting.
* [[concepts/karpathy-llm-wiki-pattern.md]] — LLM-as-compiler distillation of raw source corpora into structured knowledge nodes.
* [[concepts/local-context-cache.md]] — Zero-cloud local SQLite context cache with BM25 full-text indexing and embeddings.
* [[concepts/fail-soft-orchestration.md]] — Tier 1/2/3 governance guardrails, boundary enforcement, and dirty-worktree protection.
* [[concepts/pack-based-knowledge-management.md]] — Packing and distribution formats for offline intelligence substrates.

### 🔬 Research RFCs & Gap Triage
* [[research/rfc-gap-01--cast-iron-charlie-research-lo.md]] — GAP-01: Research and chronological provenance extraction.
* [[research/rfc-gap-02--cast-iron-charlie-research-lo.md]] — GAP-02: Under-sourced claims and contradictory evidence analysis.
* [[research/rfc-gap-03--cast-iron-charlie-research-lo.md]] — GAP-03: Cuban land seizures and agricultural holdings claims.
* [[research/rfc-gap-04--cast-iron-charlie-research-lo.md]] — GAP-04: Photographic archive cataloging and verification.

### 🛠️ Modules & Engine Subsystems
* [[entities/fleet-wiki-reconciler.ts.md]] — Multi-repository SSH wiki publisher and navigation engine.
* [[entities/cross-repo-drift-scanner.ts.md]] — Zero-tolerance cross-repository drift detector and telemetry analyzer.
* [[entities/autoheal-sweeper.mjs.md]] — Automated markdown healing sweeper with repair manifests and hash tracking.
* [[entities/entity-synthesizer.ts.md]] — Automated AST and code entity documentation generator.
* [[entities/detect-drift.ts.md]] — Local file modification, git commit date, and proof receipt validator.

---

## ⚡ Gap Triage & Closed-Loop Architecture

![KB-Sync TRM Gap Triage Architecture](trm-gap-triage-architecture.png)

---

## 🔒 Security & Governance Guarantees
- **Containment:** Edits strictly isolated to sandbox checkouts; `C:\dev` root treated as read-only.
- **Fail-Closed Drift Policy:** Non-clean telemetry or future clock skew rejects operations.
- **Cryptographic Receipts:** Every sync emits verifiable `.wiki-sync-receipt.json` records.
