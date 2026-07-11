# wiki Semantic Synthesis System

**Category:** Knowledge Curation & LLM Synthesis  
**Last Updated:** 2026-07-11

## Entities

- [[wiki module]] — Semantic wiki system; LLM-owned, human-edited entity/concept pages
- [[ingest-wiki.sh]] — Wiki update orchestration from staged sources

## Concepts

- [[Karpathy LLM-Wiki Pattern]] — LLM-maintained semantic structure using Karpathy's design
- [[Semantic Ingest Workflow]] — 8-phase synthesis workflow: Ingest → Lint → Update → Cross-Ref → Lint → Log → Review → Commit
- [[Three-Layer Vault Architecture]] — Raw sources, wiki (LLM-maintained), schema (reference)

## Module Purpose

The wiki module implements Karpathy's LLM-wiki pattern as an interactive semantic synthesis layer. Operators (Claude Code sessions) read staged raw sources, identify entities and concepts, create/update wiki pages, establish cross-references, and log all changes to an immutable audit trail. The wiki serves as a queryable knowledge base for understanding codebases without embedding stores.

---

## See Also

- [[kb-sync Core Module]] — Master orchestration scripts
- [[obsidian module]] — Vault staging infrastructure
- [[notebooklm module]] — External knowledge base sync
