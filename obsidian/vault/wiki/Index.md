# CIC Knowledge Base — Index

Welcome to the unified knowledge base vault. This vault is synchronized with:

- **NotebookLM**: Automated ingestion of CIC & Rewrite Labs documentation
- **kb-sync**: Orchestration pipeline for multi-target synchronization

## Directories

- `wiki/` — Synthesized knowledge pages (created by kb-sync)
- `_kb-sync-staging/` — Staging area for kb-sync ingestion (temporary)

## Workflow

1. **Automated sync**: `npm run kb:sync:all` flattens sources and stages in `_kb-sync-staging/`
2. **Manual synthesis**: Open staged files, create synthesized pages in `wiki/`
3. **Artifact generation**: Post-sync, interactive HTML reports are generated to `_integration/`

## Recent Syncs

- **2026-07-11 18:30 UTC**: Initial semantic synthesis from kb-sync staging (20260711-174821)
  - 13 entities created (5 kb-sync core, 3 notebooklm, 1 obsidian, 1 wiki)
  - 8 concepts created (architecture, patterns, workflow)
  - 34+ cross-references established
  - See [[wiki/Log.md]] for details

---

## Synthesized Wiki Index

**Last Updated:** 2026-07-14 21:35 UTC  
**Total Entities:** 15  
**Total Concepts:** 8

### Entities by Domain

#### kb-sync Core Module

- [[chunk.sh]] — Pack size management; chunks oversized knowledge packs for upload
- [[flatten.sh]] — Repository extraction via pyragify with AST parsing and exclusions
- [[rollback.sh]] — Rollback mechanism; restores previous known-good pack backup
- [[run-all.sh]] — Master orchestrator; executes all six pipeline phases in sequence
- [[validate.sh]] — Pack integrity validation; confirms structure and completeness
- [[artifact-generator.sh]] — Post-sync report generation; URL analysis and link health visualization

#### notebooklm Integration

- [[ingest-notebooklm.sh]] — NotebookLM sync orchestration; purges old sources and uploads fresh pack
- [[kb-sync-nightly.sh]] — Nightly scheduled sync task runner for CI/CD automation
- [[register-kb-sync-task.ps1]] — Windows Task Scheduler registration for automated nightly runs

#### obsidian Vault Integration

- [[ingest-obsidian.sh]] — Obsidian vault staging; creates timestamped immutable snapshots with manifest

#### wiki Semantic Synthesis

- [[ingest-wiki.sh]] — Wiki ingest orchestrator; coordinates eight-phase semantic synthesis workflow

#### Governance & Policy

- [[skill-approval-rules]] — Approval tiers (Tier 0 auto-install, Tier 1 review); skill development workflow

### Concepts

- [[Deterministic Sync Pipeline]] — Six-phase sequential execution model (Trigger → Flatten → Pack → Purge → Upload → Verify)
- [[Fail-Soft Orchestration]] — Multi-target execution strategy; continues despite individual target failures
- [[Karpathy LLM-Wiki Pattern]] — LLM-synthesized wiki with human review and full audit trail
- [[Manifest Mode]] — Safe ingest strategy using file manifest for staged data verification
- [[Pack-Based Knowledge Management]] — Consolidated knowledge pack as single source of truth
- [[Raw Source Staging]] — Timestamped immutable repository snapshots for auditability
- [[Semantic Ingest Workflow]] — Eight-phase workflow (Ingest → Lint → Update → Cross-Ref → Lint → Log → Review → Commit)
- [[Three-Layer Vault Architecture]] — Separation of raw sources (immutable), wiki (LLM-maintained), and schema (reference)

### Domain Folders

- **[[kb-sync/]]** — Core orchestration scripts and modules
- **[[notebooklm/]]** — NotebookLM API integration
- **[[obsidian/]]** — Obsidian vault staging and curation
- **[[wiki/]]** — Wiki semantic synthesis system
- **[[governance/]]** — Governance documents and approval policies

---

See `docs/targets/obsidian.md` for full operator workflow.
