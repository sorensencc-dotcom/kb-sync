---
entity_type: module
source_path: core/targets.mjs
repository: kb-sync
last_updated: 2026-09-14
---

# `core/targets.mjs`

Canonical NotebookLM target routing map and frontmatter extraction utilities for the kb-sync pipeline.

## Exports

### `NOTEBOOK_TARGETS`

Flat key → UUID map covering all 16 registered knowledge plane partitions:

| Key | Notebook |
|---|---|
| `willow-run` | CIC - Willow Run & Aviation Engineering |
| `ford-politics` | CIC - Ford Executive Dynamics & Politics |
| `post-war` / `willys-overland` | CIC - Post-War & Willys-Overland (alias) |
| `cuba-claims` / `cuban-seizures` | CIC - Cuban Seizures & Retired Assets (alias) |
| `miami-estate` | CIC - Miami Estate & Florida Retirement |
| `assembly-line` | CIC - Rouge, Model T & Moving Assembly Line |
| `master-kb` | CIC-KB (master historical pack — no software content) |
| `daily` | CIC - Daily Research intake buffer |
| `ironledger` | IronLedger Architecture |
| `sigil` | Sigil Protocol & Federation |
| `agent-harness` | Agent Harnesses & Local Execution |
| `rewrite-labs` | Rewrite Labs SSG Platform |
| `dev-triage` | Open Dev Issues / CI Triage |
| `personal-os` | Personal OS & Florida Logistics |

### `resolveNotebookId(category)`

Returns the UUID for `category`, falling back to the `daily` intake notebook for unknown keys.

### `extractFrontmatterCategory(content)`

Parses the `category:` field from YAML frontmatter in a markdown string. Falls back to `'daily'` if absent.

## Invariants

- `master-kb` receives **historical documentary evidence only** — no software architecture packs.
- Software partitions (`ironledger`, `sigil`, `agent-harness`, `rewrite-labs`, `dev-triage`) are permanently isolated from historical packs.
- All orchestrators (`run-closed-loop-research.mjs`, `run-closed-loop-research-v2.mjs`) import from this module as their single source of truth.
