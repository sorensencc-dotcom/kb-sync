# Knowledge Base Index

**Last Updated:** 2026-07-20 04:30 UTC  
**Pack Hash:** (from 20260720-003223 staging)  
**Total Entities:** 4  
**Total Concepts:** 4

---

## Entities

### Core Scripts & Orchestration

- [[run-all.sh]] — Master orchestrator for multi-target KB sync pipeline (fail-soft orchestration)
- [[flatten.sh]] — Generates file manifests and concatenates sources into knowledge packs
- [[ingest-obsidian.sh]] — Stages raw repository sources into Obsidian vault for human-driven wiki synthesis

### Documentation & Configuration

(Additional entities pending expansion)

---

## Concepts

### Architecture & Design Patterns

- [[fail-soft-orchestration]] — Run all KB sync targets regardless of individual failures; aggregate results at end
- [[pack-based-knowledge-management]] — Flatten entire repository into single knowledge pack for LLM context
- [[immutable-staging]] — Each sync creates timestamped, immutable staging directory; preserves historical versions
- [[karpathy-llm-wiki-pattern]] — Three-layer vault (raw sources → wiki → logs); human-in-the-loop curation with LLM synthesis

---

## Cross-Reference Map

### run-all.sh → Concepts
- [[fail-soft-orchestration]] — Direct implementation via loop + error handling
- [[deterministic-sync-pipeline]] — Part of deterministic orchestration

### flatten.sh → Concepts
- [[pack-based-knowledge-management]] — Generates packs (or manifests)
- [[immutable-staging]] — Sources feed into staging layer

### ingest-obsidian.sh → Concepts
- [[karpathy-llm-wiki-pattern]] — Stages for human-driven synthesis
- [[immutable-staging]] — Creates timestamped staging directories
- [[raw-source-staging]] — Core responsibility

### Concept Relationships
- [[fail-soft-orchestration]] ↔ [[deterministic-sync-pipeline]] — Complementary aspects of reliability
- [[pack-based-knowledge-management]] ↔ [[immutable-staging]] — Pack sources come from staging
- [[karpathy-llm-wiki-pattern]] ↔ [[immutable-staging]] ↔ [[pack-based-knowledge-management]] — Three-layer dependency chain

---

## How To Use This Wiki

1. **For understanding kb-sync architecture:** Start with concepts, then explore related entities
2. **For understanding a specific component:** Find entity in this Index, follow cross-references
3. **For audit trail of all changes:** See [[Log.md]]
4. **For semantic ingest workflow:** See `modules/wiki/operator-workflow.md`
5. **For wiki schema and conventions:** See `modules/wiki/schema.md`

---

## Next Steps

Run first semantic ingest:
1. Ensure pack exists: `npm run kb:sync`
2. Open Claude Code
3. Follow `modules/wiki/operator-workflow.md`
4. This Index.md will be populated during the ingest session

