# Obsidian Vault Sync: Wiki Schema & Ingest Workflows

This document defines the Karpathy LLM-wiki pattern implementation for syncing external repositories into your Obsidian vault as a curated, LLM-maintained knowledge base.

## Architecture: Three-Layer Vault

The vault consists of three immutable layers, each serving a distinct purpose:

### 1. Raw Sources (Immutable)

**Location**: `vault_root/_kb-sync-staging/<repo-name>/<timestamp>/`

Raw source files staged by `ingest-obsidian.sh`, never edited after staging, never directly linked from wiki pages. Each staging is timestamped so source versions remain independent. When the origin repo updates, a new staging run creates a new timestamped directory — old sources stay intact for historical citation and traceability.

**Why**: Raw sources are the audit trail. They prove what the wiki synthesized from, at what point in time. If a source file changes in the origin repo, the raw-sources layer keeps that change isolated to a new timestamp. The wiki (layer 2) references these raw sources by absolute path, so it can retroactively point to the source version that informed a particular entity/concept page.

### 2. The Wiki (LLM-Owned, Human-Edited)

**Location**: `vault_root/wiki/<domain-folder>/`

Domain-organized entity/concept pages, curated by you or Claude in interactive sessions. Human-in-the-loop synthesis — no automated pipeline updates wiki content. Domain folders defined by `mapping_rules` in `configs/obsidian.yaml` (e.g. `CIC/Rewrite Labs`, `CIC/TorqueQuery`) with a default `Unsorted` fallback.

**Conventions**:
- **Entity Pages** (e.g. `wiki/CIC/Rewrite Labs/RewriteMCP.md`): Describe a single concrete system, module, or feature. Include:
  - One-line summary (used by `Index.md`)
  - Purpose and scope
  - Key operations/endpoints
  - Links to related entities and raw sources
  - Metadata: tags, last-ingest-date, source version

- **Concept Pages** (e.g. `wiki/CIC/Rewrite Labs/ConcurrentState.md`): Discuss cross-cutting patterns, design decisions, or architectural concepts. Include:
  - Problem statement
  - Solution overview
  - Examples from entities or raw sources
  - Related pages and resources

- **Index.md** (per domain folder): Catalog of all entities and concepts in that folder. Format:
  ```markdown
  # CIC/Rewrite Labs

  ## Entities
  - [RewriteMCP](./RewriteMCP.md) — Core compiler for Rewrite DSL
  - [Phase System](./PhaseSystem.md) — Multi-phase execution model

  ## Concepts
  - [ConcurrentState](./ConcurrentState.md) — Managing state in distributed pipelines
  ```
  Use for cheap agent navigation without embedding stores.

- **Log.md** (vault root): Append-only operation log with parseable `## [DATE TIME] <operation>` entries. Examples:
  ```markdown
  ## [2024-01-15 14:30] ingest

  Staged sources from rewrite-mcp/ (commit abc1234).
  Updated Entity: RewriteMCP — added Phase 4 outputs.
  New Concept: Cross-Artifact Caching Strategy.
  New Entity: MetadataPreserver.

  Raw sources: _kb-sync-staging/rewrite-mcp/20240115-143012/

  ## [2024-01-15 15:45] query

  Asked: "How do we handle concurrent state in Phase 3?"
  Answer synthesized from Phase3Executor + ConcurrentState concept.
  Result: new Concept page, CrossPhaseCoordination.md.

  ## [2024-01-16 10:00] lint

  Checked Entity links in CIC/Rewrite Labs/ folder.
  Fixed broken reference: Phase3Executor → Phase4Executor (source updated).
  Orphaned page: DeprecatedHasher (marked for removal).
  ```
  This log is queryable and auditable — critical for tracking what the LLM has synthesized and when.

## Ingest Workflow

**Trigger**: Run `npm run kb:sync:obsidian` to stage new/updated sources.

**Setup**: 
1. Verify `OBSIDIAN_VAULT_ROOT` env var or `vault_root` in `configs/obsidian.yaml` points to your vault directory.
2. Raw sources are staged under `vault_root/_kb-sync-staging/<repo>/<timestamp>/` preserving directory structure.
3. A manifest (`FILES.manifest.txt`) lists all staged files for reference.

**Claude Code Session** (Human-Triggered):
1. Open Claude Code (this codebase + your Obsidian vault in focus).
2. Reference this schema doc (`docs/targets/obsidian.md`) and your vault's existing `Index.md` structures.
3. Claude reads the staged sources and your current wiki state.
4. For each changed/new entity or concept:
   - Create or update `.md` page in the appropriate `wiki/<domain-folder>/`.
   - Include one-line summary (for `Index.md`), detailed content, and raw-source citations.
   - Add/update links to related entities and concepts.
5. Update each domain's `Index.md` with new/changed entities and concepts.
6. Append an entry to `vault_root/wiki/Log.md` documenting the ingest run, staged source path, and changes.

**Example Session**:
```
You: "The raw sources in _kb-sync-staging/rewrite-mcp/20240115-143012/ are staged.
     Update the wiki (wiki/CIC/Rewrite Labs/...) with new entities and concepts.
     Update Index.md and Log.md. Use the schema doc (docs/targets/obsidian.md) as guidance."

Claude: [reads staging dir + current wiki state + schema doc]
        "I found 3 new files in Phase 4:
         - RewriteCompiler.ts: new compiler backend
         - MetadataPreserver.ts: tracking cross-artifact state
         - IntegrationTests.ts: Phase 4 validation suite
        
        Creating:
        - Entity: RewriteCompiler → wiki/CIC/Rewrite Labs/RewriteCompiler.md
        - Entity: MetadataPreserver → wiki/CIC/Rewrite Labs/MetadataPreserver.md
        - Concept: Cross-Artifact State Management → wiki/CIC/Rewrite Labs/CrossArtifactState.md
        
        Updating Index.md and Log.md..."
```

## Query Workflow

**Trigger**: Ask a question in Claude Code scoped to your vault (`wiki/` directory).

**Process**:
1. Claude searches `Index.md` files (quick navigation without embeddings).
2. Reads relevant entity/concept pages referenced in indices.
3. Synthesizes answer with citations back to raw sources and pages.
4. New insights that warrant persistent knowledge become new wiki pages.
5. Append a `Log.md` entry documenting the query and any new pages created.

**Example**:
```
You: "How do we handle concurrent state in Phase 3?"

Claude: [searches Index.md, finds ConcurrentState concept + Phase3Executor entity]
        "Found in wiki/CIC/Rewrite Labs/:
         - ConcurrentState.md (concept) → explains pattern
         - Phase3Executor.md (entity) → describes implementation
        
        Answer: Phase 3 uses...
        
        Sources:
        - _kb-sync-staging/rewrite-mcp/20240115-143012/phase3/executor.ts
        - wiki/CIC/Rewrite Labs/ConcurrentState.md"
```

## Lint Workflow

**Trigger**: Periodically run a Claude Code lint pass (human-initiated).

**Process**:
1. Claude walks all `wiki/<domain-folder>/` pages and `Index.md`.
2. Checks for:
   - Broken links (references to pages that don't exist)
   - Orphaned pages (not linked from any `Index.md` or entity/concept)
   - Contradictions (two pages claiming opposite facts)
   - Stale citations (raw-source path no longer exists in latest staging)
   - Missing metadata (entities without summary lines)
3. Flags findings in `Log.md` with actionable next steps (fix link, delete page, verify fact, etc.).
4. Human reviews and accepts/rejects changes.

**Example Log Entry**:
```markdown
## [2024-01-20 11:15] lint

Checked wiki/CIC/Rewrite Labs/ (28 pages).
- Broken link: Phase4System.md → "Phase3Executor" (renamed to Phase4Executor in raw sources).
  Action: Update link to Phase4Executor, add migration note.
- Orphaned page: OldHashingStrategy.md (not in Index.md, no inbound links).
  Action: Delete or move to archive/.
- Contradiction: Phase3Executor.md says "uses mutex", ConcurrentState.md says "lock-free".
  Action: Review latest sources and reconcile.
- Stale citation: Entity links to _kb-sync-staging/rewrite-mcp/20231215-*/ (old timestamp).
  Action: Verify with latest staging (20240115-*/).
```

## Configuration

### vault_root
Obsidian vault root directory. Override via `OBSIDIAN_VAULT_ROOT` env var.

### mapping_rules
Domain folder mappings applied during ingest. Guidance for where to place new entity/concept pages, not enforced mechanically:
```yaml
mapping_rules:
  - prefix: "rewrite-mcp/"
    folder: "CIC/Rewrite Labs"
  - prefix: "torquequery/"
    folder: "CIC/TorqueQuery"
```

### default_folder
Fallback for sources not matching any prefix. Default: `Unsorted`.

### staging_dir / wiki_dir
Subdirectories inside `vault_root` for raw sources and wiki content, respectively.

### index_filename / log_filename
Names of the per-folder index and the shared operation log inside `wiki_dir`.

## Git Best Practices

If you git-init your `vault_root`:
- Commit wiki pages regularly (version control for entity/concept content).
- Ignore `_kb-sync-staging/` (raw sources don't need version control).
- Use commit messages to note ingest runs: `"ingest: rewrite-mcp 20240115"`.
- `git revert` to undo a wiki update without running a full rollback.

## Boundaries

What the staging script does:
- ✓ Copies raw sources into timestamped directories
- ✓ Generates manifest (file list)
- ✓ Preserves directory structure

What the staging script does **not** do:
- ✗ Edit vault content
- ✗ Synthesize entities or concepts
- ✗ Update Index.md or Log.md
- ✗ Enforce placement (mapping_rules are guidance only)

All synthesis is human-triggered (Claude Code session or manual edits).

## See Also
- [kb-sync Architecture](../kb/notebooklm-sync/architecture.md)
- [NotebookLM Target](./notebooklm.md)
- [Staging Script: modules/obsidian/ingest-obsidian.sh](../../modules/obsidian/)
