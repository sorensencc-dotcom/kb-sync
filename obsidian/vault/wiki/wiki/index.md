---
title: "wiki Semantic Synthesis System"
category: "wiki"
status: "active"
---

# wiki Semantic Synthesis System

**Category:** Knowledge Curation & LLM Synthesis  
**Last Updated:** 2026-07-11

## Entities

- [[kb-sync/wiki/index|wiki module]] — Semantic wiki system; LLM-owned, human-edited entity/concept pages
- [[kb-sync/wiki/ingest-wiki.sh|ingest-wiki.sh]] — Wiki update orchestration from staged sources

## Concepts

- [[kb-sync/concepts/karpathy-llm-wiki-pattern|Karpathy LLM-Wiki Pattern]] — LLM-maintained semantic structure using Karpathy's design
- [[kb-sync/concepts/semantic-ingest-workflow|Semantic Ingest Workflow]] — 8-phase synthesis workflow: Ingest → Lint → Update → Cross-Ref → Lint → Log → Review → Commit
- [[kb-sync/concepts/three-layer-vault-architecture|Three-Layer Vault Architecture]] — Raw sources, wiki (LLM-maintained), schema (reference)

## Module Purpose

The wiki module implements Karpathy's LLM-wiki pattern as an interactive semantic synthesis layer. Operators (Claude Code sessions) read staged raw sources, identify entities and concepts, create/update wiki pages, establish cross-references, and log all changes to an immutable audit trail. The wiki serves as a queryable knowledge base for understanding codebases without embedding stores.

---

## See Also

- [[kb-sync/kb-sync/index|kb-sync Core Module]] — Master orchestration scripts
- [[kb-sync/obsidian/index|obsidian module]] — Vault staging infrastructure
- [[kb-sync/notebooklm/index|notebooklm module]] — External knowledge base sync
