---
title: "obsidian Vault Integration"
category: "wiki"
status: "active"
---

# obsidian Vault Integration

**Category:** Local Vault Staging & Curation  
**Last Updated:** 2026-07-11

## Entities

- [[kb-sync/obsidian/index|obsidian module]] — Obsidian vault staging and sync layer
- [[kb-sync/obsidian/ingest-obsidian.sh|ingest-obsidian.sh]] — Staged source ingestion; preserves directory structure in timestamped snapshots

## Concepts

- [[kb-sync/concepts/three-layer-vault-architecture|Three-Layer Vault Architecture]] — Raw sources (immutable) → Wiki (LLM-maintained) → Schema (reference)
- [[kb-sync/concepts/raw-source-staging|Raw Source Staging]] — Timestamped immutable copies for auditability and historical citation
- [[kb-sync/concepts/manifest-mode|Manifest Mode]] — Safe ingest strategy using file manifest for validation

## Module Purpose

The obsidian module provides integrated staging and curation of external repositories into your Obsidian vault as a human-in-the-loop knowledge base. Raw sources are captured in immutable timestamped directories; the wiki layer synthesizes entities and concepts via Claude Code sessions; the schema defines conventions. No automated pipeline updates wiki content.

---

## See Also

- [[kb-sync/kb-sync/index|kb-sync Core Module]] — Master orchestration scripts
- [[kb-sync/notebooklm/index|notebooklm module]] — Alternative sync target (NotebookLM)
- [[kb-sync/wiki/index|wiki module]] — Semantic synthesis system
