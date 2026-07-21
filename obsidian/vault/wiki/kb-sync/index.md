---
title: "kb-sync Core Module"
category: "wiki"
status: "active"
---

# kb-sync Core Module

**Category:** Infrastructure & System Orchestration  
**Last Updated:** 2026-07-17

## Entities

- [[kb-sync/kb-sync/run-all.sh|run-all.sh]] — Master orchestrator script; executes all pipeline stages
- [[kb-sync/kb-sync/flatten.sh|flatten.sh]] — Repository flattening via pyragify; AST parsing and file extraction
- [[kb-sync/kb-sync/chunk.sh|chunk.sh]] — Pack chunking for oversized outputs (5MB+ warning, 8MB limit)
- [[kb-sync/kb-sync/validate.sh|validate.sh]] — Pack integrity validation and structure verification
- [[kb-sync/kb-sync/artifact-generator.sh|artifact-generator.sh]] — Post-sync report generation; URL analysis and link health visualization
- [[kb-sync/kb-sync/wiki-schema|Wiki Schema]] — Three-layer Karpathy LLM-wiki pattern architecture and page templates
- [[kb-sync/kb-sync/wiki-operator-workflow|Wiki Operator Workflow]] — Complete 8-phase guide for wiki semantic synthesis via Claude Code
- [[kb-sync/kb-sync/wiki-lint-rules|Wiki Lint Rules]] — Structural, referential, and semantic integrity checks for wiki
- [[kb-sync/kb-sync/wiki-update-rules|Wiki Update Rules]] — Rules for creating, updating, and removing wiki entity/concept pages

## Concepts

- [[kb-sync/concepts/pack-based-knowledge-management|Pack-Based Knowledge Management]] — Consolidated single-file knowledge representation
- [[kb-sync/concepts/deterministic-sync-pipeline|Deterministic Sync Pipeline]] — Sequential, repeatable execution with state tracking
- [[kb-sync/concepts/fail-soft-orchestration|Fail-Soft Orchestration]] — Multi-stage execution that continues despite individual failures

## Module Purpose

The kb-sync core module provides the foundational scripting infrastructure for flattening codebases, consolidating them into knowledge packs, and distributing them to multiple targets (NotebookLM, Obsidian, wiki systems). All scripts are orchestrated via `npm run kb:sync` or manual trigger.

---

## See Also

- [[kb-sync/notebooklm/index|notebooklm module]] — NotebookLM-specific sync pipeline
- [[kb-sync/obsidian/index|obsidian module]] — Obsidian vault staging integration
- [[kb-sync/wiki/index|wiki module]] — Wiki semantic synthesis system
