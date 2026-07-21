---
title: "ingest-wiki.sh"
category: "sync-tools"
status: "active"
---

# ingest-wiki.sh

**Type:** Script  
**Location:** `modules/wiki/ingest-wiki.sh`  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Summary

Wiki update orchestration script that coordinates the eight-phase semantic ingest workflow: Ingest → Lint → Update → Cross-Ref → Lint → Log → Review → Commit.

Serves as the entry point for Claude Code sessions to systematically synthesize entities and concepts from staged raw sources, maintain wiki structure and quality, and commit changes with audit trail.

---

## Attributes

### Input
- Staged raw sources (from `_kb-sync-staging/` directory)
- Current wiki state (`wiki/Index.md`, entity/concept pages)
- Schema docs: `modules/wiki/schema.md`, `modules/wiki/lint-rules.md`, `modules/wiki/update-rules.md`

### Output
- Updated wiki pages (entities, concepts, Index.md)
- Updated `wiki/Log.md` with ingest session entry
- Git commit recording all changes
- Exit code: 0 (success), 1 (lint failure, no changes committed)

### Side Effects
- Modifies wiki directory (creates/updates entity and concept pages)
- Modifies `wiki/Index.md` and `wiki/Log.md`
- Creates git commit (if operator approves Phase 7: Review)
- Does not modify raw sources (read-only)

### Performance Characteristics
- Runtime: 10–60 minutes (depends on repository size and operator decisions)
- Human-paced (requires Claude Code operator for each phase)
- I/O bound (reading staged sources, writing wiki pages)

### Constraints & Limits
- Requires Claude Code session (interactive, not automated)
- Requires operator review at Phase 7 before commit
- Cannot run concurrently with other wiki edits (would create merge conflicts)
- Schema docs must be available and readable

---

## Relationships

### Called By
- Operator via Claude Code session
- Manual invocation (e.g., `bash modules/wiki/ingest-wiki.sh`)

### Calls / Depends On
- Staged raw sources (`_kb-sync-staging/`)
- Wiki schema docs (`modules/wiki/schema.md`, etc.)
- Current wiki state (`wiki/`, `wiki/Index.md`)
- Git environment (for commit)

### Related Concepts
- [[kb-sync/concepts/semantic-ingest-workflow|Semantic Ingest Workflow]] — 8-phase workflow orchestration
- [[kb-sync/concepts/karpathy-llm-wiki-pattern|Karpathy LLM-Wiki Pattern]] — implements Karpathy's wiki design
- [[kb-sync/concepts/three-layer-vault-architecture|Three-Layer Vault Architecture]] — wiki layer synthesis

### Participates In Workflows
- [[kb-sync/concepts/semantic-ingest-workflow|Semantic Ingest Workflow]]
- Human-in-the-loop knowledge curation

---

## Cross-References

### Bidirectional Links

- Related entities: [[kb-sync/kb-sync/run-all.sh|run-all.sh]]
- Related concepts: [[kb-sync/concepts/semantic-ingest-workflow|Semantic Ingest Workflow]], [[kb-sync/concepts/karpathy-llm-wiki-pattern|Karpathy LLM-Wiki Pattern]], [[kb-sync/concepts/three-layer-vault-architecture|Three-Layer Vault Architecture]]
- Backlinks from: [[kb-sync/wiki/index|wiki module]]

---

## Source Citations

**Primary Source:** `modules/wiki/ingest-wiki.sh`  
**Related:** `modules/wiki/operator-workflow.md` (8-phase workflow guide)  
**Schema:** `modules/wiki/schema.md` (entity/concept templates)  
**Pack Reference:** `--- START FILE: modules/wiki/ingest-wiki.sh ---` to `--- END FILE: modules/wiki/ingest-wiki.sh ---`

---

## Implementation Notes

The script is primarily a guide/orchestrator for Claude Code sessions, not a standalone automation tool. Each phase (Ingest, Lint, Update, Cross-Ref, Lint, Log, Review, Commit) is human-driven with prompts to Claude Code. The script checks prerequisites, validates pack exists, and verifies wiki structure before proceeding.

The eight-phase workflow ensures:
1. **Phase 1 (Ingest):** Identify all new/updated entities and concepts
2. **Phase 2 (Lint):** Check existing wiki for issues before updating
3. **Phase 3 (Update):** Create/update pages with new content
4. **Phase 4 (Cross-Ref):** Establish bidirectional links
5. **Phase 5 (Lint):** Verify Phase 3-4 changes didn't break anything
6. **Phase 6 (Log):** Record session in Log.md
7. **Phase 7 (Review):** Operator spot-checks and approves
8. **Phase 8 (Commit):** Git commit all changes

No automated updates to wiki content; all synthesis is operator-approved.
