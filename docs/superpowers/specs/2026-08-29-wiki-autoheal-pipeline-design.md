# Wiki autohealing sweeper and path-isolated pipeline design

## Overview

This specification establishes a five-stage pipeline for documentation ingestion and wiki synthesis in `kb-sync`. The system cleanly separates deterministic metadata healing from cognitive synthesis and schema validation, resolving the fail-closed deadlock caused by minor formatting flaws across staged markdown documents while preserving strict transaction safety and sandbox path isolation.

## Problem statement & root causes

When automated research synthesis or ingestion pipelines process markdown documents, minor metadata errors block the entire pipeline:
1. **Shared path contamination**: Synthesis scripts resolve target paths directly to host locations (`C:\dev\wiki`), risking workspace collision when executed in sandbox clones.
2. **Binary validation gates**: The contract validator ([`validate-contract.mjs`](file:///C:/dev/kb-sync/modules/wiki/validate-contract.mjs)) triggers atomic rollbacks when encountering missing YAML headers, uppercase or unmapped category enums, or relative `[[wikilinks]]`.
3. **Category and repository schema drift**: The schema contract whitelist in [`toolforge-kbsync-contract.json`](file:///C:/dev/kb-sync/modules/wiki/toolforge-kbsync-contract.json) rejects valid payloads from `trm`, `cic-ingestion`, and emerging research categories.

## Architecture & pipeline flow

```
┌────────────────────────────────────────────────────────┐
│ Stage 1: Ingestion / Scratch Scaffolding               │
│ - Raw markdown generated with loose metadata & links   │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Stage 2: Path Isolation (config-loader.mjs)            │
│ - CLI: --vault-root=<path>                             │
│ - Env: VAULT_ROOT                                      │
│ - Fallback: process.cwd() / repository root            │
│ - Resolves isolated staging and target directory trees │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Stage 3: Autoheal Sweeper (autoheal-sweeper.mjs)       │
│ - Injects missing YAML fences & default properties     │
│ - Normalizes status & category enum values             │
│ - Rewrites relative wikilinks to absolute vault paths  │
│ - Emits structured audit report (.autoheal-report.json)│
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Stage 4: Contract Validator (validate-contract.mjs)    │
│ - Evaluates normalized markdown against schema contract│
│ - Enforces strict zero-tolerance structural gate       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Stage 5: Atomic Commit & Promotion                     │
│ - Promotes staging files to live wiki directory        │
│ - Cleans staging artifacts and records sync summary    │
└───────────────────────────┬────────────────────────────┘
```

## Detailed component specifications

### 1. Path resolver: `modules/wiki/config-loader.mjs`

Provides centralized path resolution across all wiki maintenance tools, preventing cross-workspace contamination.

- **Resolution priority**:
  1. CLI argument: `--vault-root=<path>`
  2. Environment variable: `process.env.VAULT_ROOT`
  3. Current working directory fallback: `process.cwd()`
- **Resolved directory map**:
  - `vaultRoot`: Base repository root.
  - `wikiDir`: Path to `wiki/` directory.
  - `stagingDir`: Path to `_kb-sync-staging/` directory.
  - `researchDir`: Path to `wiki/research/` directory.
  - `transactDir`: Path to `.transact-<sessionId>/` temporary workspace.

### 2. Autohealing sweeper: `modules/wiki/autoheal-sweeper.mjs`

Performs deterministic, idempotent repairs on staged markdown documents prior to validation.

- **Frontmatter injection**:
  - Checks if content begins with `---`.
  - If missing, derives title from filename base, assigns category `wiki`, status `draft`, and source repository `kb-sync`.
  - If frontmatter exists but misses required fields (`title`, `category`, `status`), injects defaults while preserving custom properties.
- **Enum normalization**:
  - Categories: Lowercases and converts spaces to dashes. Validates against the contract whitelist; unknown categories map to `wiki` (or `research` for files inside research folders).
  - Statuses: Lowercases and maps synonyms (`WIP` -> `draft`, `Review` -> `proposed`). Allowed values: `active`, `beta`, `archived`, `draft`, and `proposed`.
- **Manifest-aware wikilink rewriting**:
  - Scans existing vault notes to build a target path index: `{ [noteBaseName]: relativeVaultPath }`.
  - Matches un-namespaced links: `(?<!\[\[)(?<=\[\[)(?!kb-sync\/|toolforge\/|rewrite-docs\/|trm\/|cic-ingestion\/)([^\]|]+)(.*?)(?=\]\])`.
  - If target basename exists in vault index, rewrites to `[[kb-sync/wiki/<category>/<TargetNote>]]`.
  - If target basename does not exist in vault index, rewrites to fallback research path: `[[kb-sync/wiki/research/<TargetNote>]]`.
  - Ignores links within fenced code blocks.
- **Audit report generation**:
  - Writes summary to `.autoheal-report.json` detailing scanned count, modified count, and per-file mutation records.

### 3. Schema contract update: `modules/wiki/toolforge-kbsync-contract.json`

Expands contract whitelists to accommodate TRM and research documents.

- **`sourceRepository` enum**:
  ```json
  "enum": [
    "toolforge",
    "kb-sync",
    "rewrite-docs",
    "cic-ingestion",
    "rewrite-mcp",
    "cic-os",
    "charlie-deep-research",
    "sigil",
    "castironforge",
    "trm"
  ]
  ```
- **`category` enum**:
  ```json
  "enum": [
    "daemons",
    "utilities",
    "sync-tools",
    "adapters",
    "mcp-servers",
    "scaffolds",
    "prototypes",
    "wiki",
    "research",
    "lessons"
  ]
  ```
- **`status` enum**:
  ```json
  "enum": [
    "active",
    "beta",
    "archived",
    "draft",
    "proposed"
  ]
  ```

### 4. Integration into validation gates

Updates [`modules/wiki/validate-staging-docs.mjs`](file:///C:/dev/kb-sync/modules/wiki/validate-staging-docs.mjs) and [`modules/wiki/gated-climb-repair.mjs`](file:///C:/dev/kb-sync/modules/wiki/gated-climb-repair.mjs) to:
1. Import `resolveVaultPaths` and `sweepStagingVault`.
2. Execute the autoheal sweep over staging notes before invoking contract checks.
3. Validate sanitized notes with zero-tolerance contract rules.

## Verification plan

### Automated tests

1. **Unit tests (`tests/modules/wiki/config-loader.test.mjs`)**:
   - Verify argument parsing (`--vault-root`).
   - Verify environment variable override (`VAULT_ROOT`).
   - Verify fallback directory generation.
2. **Unit tests (`tests/modules/wiki/autoheal-sweeper.test.mjs`)**:
   - Frontmatter injection on raw markdown.
   - Preservation of existing custom frontmatter attributes.
   - Normalization of irregular category and status enums.
   - Wikilink resolution against an index of known basenames vs unknown fallbacks.
   - Code fence link preservation.
3. **Contract test (`tests/modules/wiki/validate-contract.test.mjs`)**:
   - Confirm contract validation passes on output of `autoheal-sweeper.mjs`.

### Manual verification & backfill run

1. Run `node modules/wiki/autoheal-sweeper.mjs --vault-root=C:\dev\kb-sync --fix` on staging files.
2. Run `node scripts/wiki-contract-backfill.mjs --dry-run` to confirm zero contract violations.
3. Run `npm run test:trm` to verify complete test suite execution.
