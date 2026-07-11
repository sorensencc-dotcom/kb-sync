# Raw Source Staging

**Type:** Pattern  
**Domain:** obsidian, knowledge-management  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Definition

Raw source staging is the practice of capturing external repository sources as immutable, timestamped snapshots in a dedicated staging directory (`_kb-sync-staging/<repo>/<YYYYMMDD-HHMMSS>/`). Each staging run creates a new timestamped directory; previous stagings remain intact, providing historical versions and enabling retroactive citation.

---

## Why It Matters

Raw sources are the audit trail and source of truth. By making stagings immutable and timestamped, operators can cite specific source versions (by absolute path) in wiki pages without fear the source will disappear or change. When a repository evolves, new staging runs create new directories; old stagings remain available for historical context.

This pattern also enables traceability: if a wiki page cites a specific source version, that citation remains valid indefinitely, even if the source file was later renamed or deleted in the origin repository.

---

## Subconcepts

- **Timestamping:** Each staging run gets a unique timestamp (YYYYMMDD-HHMMSS)
- **Immutability:** Raw sources are never edited after staging
- **Directory Preservation:** Source directory structure is maintained in staging
- **Manifest Generation:** `FILES.manifest.txt` lists all staged files
- **No Synthesis:** Staging is extraction only; no semantic changes

---

## Related Concepts

- [[Three-Layer Vault Architecture]] — Layer 1 (raw sources)
- [[Manifest Mode]] — safe ingest strategy using manifest
- [[Karpathy LLM-Wiki Pattern]] — raw sources support explicit synthesis

---

## Examples

**Example 1: [[ingest-obsidian.sh]] implements raw source staging**
- Stages kb-sync repo into `vault_root/_kb-sync-staging/kb-sync/20260711-174821/`
- Creates second staging: `vault_root/_kb-sync-staging/kb-sync/20260712-093015/`
- Both stagings remain; old one is audit trail
- Wiki pages can cite either version by absolute path
- Result: historical versions are always available

**Example 2: Retroactive citation in wiki synthesis**
- Wiki page created during 20260711-174821 staging cites `_kb-sync-staging/kb-sync/20260711-174821/modules/wiki/schema.md`
- Repository evolves; next staging (20260712-093015) has updated schema
- Original wiki page citation still resolves (old staging remains)
- New wiki page can cite updated schema from new staging
- Result: versioned citations maintain validity

**Example 3: Manifest enables safe ingest**
- Staging creates `FILES.manifest.txt` listing all staged files
- Claude Code session verifies manifest before synthesizing wiki content
- Manifest prevents accidental over-writes or missing files
- Result: [[Manifest Mode]] ensures data integrity

---

## Cross-References

### Entities That Use This Concept

- [[ingest-obsidian.sh]] — primary implementation

### Concepts This Concept Depends On

- [[Three-Layer Vault Architecture]] — Layer 1

### Backlinks From

- [[Three-Layer Vault Architecture]]
- [[Manifest Mode]]

---

## Source Citations

**Primary Source:** `modules/obsidian/ingest-obsidian.sh` (staging implementation)  
**Schema:** `docs/targets/obsidian.md` (three-layer vault section)  
**Configuration:** `configs/obsidian.yaml` (vault root, mapping rules)  
**Pack Reference:** Staging directories (`_kb-sync-staging/*/`)

---

## Governance & Rules

**Enforcement:**
- Raw sources must never be edited after staging (only new stagings allowed)
- Staging directories must be timestamped (no manual naming)
- Manifest must be generated for every staging run

**Decision Gates:**
- Operators should not delete old stagings without explicit archival decision

**Exceptions:**
- Old stagings can be deleted if storage is constrained (but breaks wiki pages citing them)

---

## Rationale & History

Early Obsidian vault integrations directly ingested external sources into the vault without staging. This caused data loss when sources were updated (old versions were overwritten) and made historical versioning impossible. Raw source staging preserves all versions immutably, enabling operators to cite specific source versions and maintain historical context.

The pattern also supports distributed teams: multiple operators can reference the same staging by absolute path without creating version conflicts.

---

## Related Pages

- See [[Three-Layer Vault Architecture]] for Layer 1
- See [[Manifest Mode]] for safe ingest strategy
- See [[Semantic Ingest Workflow]] for wiki synthesis workflow
