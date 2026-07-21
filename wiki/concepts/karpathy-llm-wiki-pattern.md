# Karpathy LLM-Wiki Pattern

**Type**: Knowledge Management Architecture  
**Domain**: kb-sync design philosophy  
**Status**: Active

---

## Problem

How can you build a curated, LLM-maintained knowledge base from a large source repository without fully automating the process and losing operator control?

**Naive approach**: Generate wiki pages completely automatically. Result: Hallucinated relationships, inconsistent schemas, hard to debug.

**Karpathy pattern**: Human-in-the-loop: Stage raw sources → LLM synthesizes → Human reviews → Human commits.

---

## Solution

The **Karpathy LLM-Wiki Pattern** (named after Andrej Karpathy's approach to dataset curation) separates data into immutable layers:

### Three-Layer Vault Architecture

1. **Raw Sources** (Immutable)
   - Location: `vault_root/_kb-sync-staging/<repo>/<timestamp>/`
   - Never edited after staging
   - Immutable audit trail of what LLM synthesized from

2. **The Wiki** (LLM-Owned, Human-Edited)
   - Location: `vault_root/wiki/<domain>/`
   - Entity pages (one per system/module/component)
   - Concept pages (architectural patterns, principles)
   - Human approval on all edits before commit

3. **Logs** (Append-Only)
   - Location: `vault_root/wiki/Log.md`
   - Records every synthesis session
   - Timestamps and operator names
   - Traceability from wiki → staging → raw sources

### Workflow

**Phase 1: Ingest** — LLM reads staged sources, identifies new entities and concepts  
**Phase 2: Lint** — LLM verifies current wiki for structural issues  
**Phase 3: Update** — LLM creates/modifies entity and concept pages  
**Phase 4: Cross-Ref** — LLM establishes bidirectional links  
**Phase 5: Lint** — LLM re-verifies after updates  
**Phase 6: Log** — LLM records the session  
**Phase 7: Review** — Human spot-checks accuracy  
**Phase 8: Commit** — Human commits with summary  

---

## Key Principles

1. **Staged Sources are Immutable**: LLM synthesizes from these; they never change
2. **Wiki is Authored by LLM, Curated by Humans**: LLM generates drafts; human approves before merge
3. **Cross-Referencing is Automatic**: LLM establishes links; human verifies
4. **Logging is Comprehensive**: Every synthesis session is logged for audit trail
5. **Operator Control is Explicit**: Human explicitly approves before any commit

---

## Examples

**Scenario**: Sync `rewrite-mcp/` sources into wiki for first time.

1. Run `npm run kb:sync:obsidian` → sources staged to `_kb-sync-staging/kb-sync/20260720-003223/`
2. Open Claude Code session with staged sources + wiki schema
3. LLM reads staged sources, identifies entities (RewriteMCP, PhaseSystem, etc.)
4. LLM creates entity pages in `wiki/CIC/Rewrite Labs/`
5. Human reviews pages for accuracy
6. Human commits to git with message: "Initial wiki synthesis from rewrite-mcp (commit abc1234)"
7. Log entry appended: `## [2026-07-20 10:30] Initial wiki synthesis`

**Second sync**: `rewrite-mcp/` is updated with new Phase 4 logic.

1. Run `npm run kb:sync:obsidian` again → new staging at `_kb-sync-staging/kb-sync/20260720-153000/`
2. LLM compares old vs. new staging
3. LLM finds PhaseSystem has changed; updates entity page
4. LLM creates new concept: "Multi-Phase Execution Model"
5. Human reviews and approves
6. Human commits with log entry

---

## Advantages Over Alternatives

| Approach | Pros | Cons |
|----------|------|------|
| **Fully Manual** (no LLM) | Full control | Slow, error-prone |
| **Fully Automated** (no human) | Fast | Hallucinations, wrong links, hard to debug |
| **Karpathy Pattern** (this one) | Fast + Accurate + Auditable | Requires human approval step |

---

## Related Concepts

- [[immutable-staging]] — Staging layer is immutable
- [[pack-based-knowledge-management]] — Packs are synthesized into wiki
- [[deterministic-sync-pipeline]] — Repeatable and auditable

---

## Related Entities

- [[ingest-obsidian.sh]] — Stages sources (feeds into pattern)
- [[ingest-wiki.sh]] — Validates staging and generates prompts

---

## Metadata

- **Introduced**: kb-sync v1.0  
- **Pattern Origin**: Named after Andrej Karpathy's "Data Curation" philosophy (LLM context at scale)  
- **Ingest Date**: 2026-07-20  
- **Last Updated**: [TBD]
