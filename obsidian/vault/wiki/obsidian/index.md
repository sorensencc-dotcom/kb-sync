# obsidian Vault Integration

**Category:** Local Vault Staging & Curation  
**Last Updated:** 2026-07-11

## Entities

- [[obsidian module]] — Obsidian vault staging and sync layer
- [[ingest-obsidian.sh]] — Staged source ingestion; preserves directory structure in timestamped snapshots

## Concepts

- [[Three-Layer Vault Architecture]] — Raw sources (immutable) → Wiki (LLM-maintained) → Schema (reference)
- [[Raw Source Staging]] — Timestamped immutable copies for auditability and historical citation
- [[Manifest Mode]] — Safe ingest strategy using file manifest for validation

## Module Purpose

The obsidian module provides integrated staging and curation of external repositories into your Obsidian vault as a human-in-the-loop knowledge base. Raw sources are captured in immutable timestamped directories; the wiki layer synthesizes entities and concepts via Claude Code sessions; the schema defines conventions. No automated pipeline updates wiki content.

---

## See Also

- [[kb-sync Core Module]] — Master orchestration scripts
- [[notebooklm module]] — Alternative sync target (NotebookLM)
- [[wiki module]] — Semantic synthesis system
