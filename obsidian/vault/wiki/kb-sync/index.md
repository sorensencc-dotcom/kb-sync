# kb-sync Core Module

**Category:** Infrastructure & System Orchestration  
**Last Updated:** 2026-07-17

## Entities

- [[run-all.sh]] — Master orchestrator script; executes all pipeline stages
- [[flatten.sh]] — Repository flattening via pyragify; AST parsing and file extraction
- [[chunk.sh]] — Pack chunking for oversized outputs (5MB+ warning, 8MB limit)
- [[validate.sh]] — Pack integrity validation and structure verification
- [[artifact-generator.sh]] — Post-sync report generation; URL analysis and link health visualization
- [[Wiki Schema]] — Three-layer Karpathy LLM-wiki pattern architecture and page templates
- [[Wiki Operator Workflow]] — Complete 8-phase guide for wiki semantic synthesis via Claude Code
- [[Wiki Lint Rules]] — Structural, referential, and semantic integrity checks for wiki
- [[Wiki Update Rules]] — Rules for creating, updating, and removing wiki entity/concept pages

## Concepts

- [[Pack-Based Knowledge Management]] — Consolidated single-file knowledge representation
- [[Deterministic Sync Pipeline]] — Sequential, repeatable execution with state tracking
- [[Fail-Soft Orchestration]] — Multi-stage execution that continues despite individual failures

## Module Purpose

The kb-sync core module provides the foundational scripting infrastructure for flattening codebases, consolidating them into knowledge packs, and distributing them to multiple targets (NotebookLM, Obsidian, wiki systems). All scripts are orchestrated via `npm run kb:sync` or manual trigger.

---

## See Also

- [[notebooklm module]] — NotebookLM-specific sync pipeline
- [[obsidian module]] — Obsidian vault staging integration
- [[wiki module]] — Wiki semantic synthesis system
