# Changelog

All notable changes to this project will be documented in this file.

## [0.1.3.0] - 2026-08-08

### Added
- **Headless NotebookLM Stage 3 Integration Hardening** (`modules/notebooklm/ingest-notebooklm.sh`): Stage 3 upload pipeline featuring Master Token preflight checks, cookie auto-recovery, structural stdin JSON list parsing (`printf '%s'`), exact pack-name pattern filtering (`^repo_knowledge_pack(_part_[0-9]+)?\.txt$`), staged zero-downtime uploads, atomic telemetry (`.sync-status.json`), and multi-run state reconciliation.
- **Fail-Closed Rollback Path**: Restored backup files re-uploaded BEFORE purging old sources, maintaining 100% staged zero-downtime guarantees during `--rollback`.
- **13-Case Verification Suite** (`tests/modules/test-notebooklm-ingest.sh`): Comprehensive isolated fixture test harness with stateful unique-ID mock CLI covering auth checks, atomic telemetry, call ordering, error paths, malformed JSON, timeout boundaries, rollback safety, and state reconciliation.

### Fixed
- **Loud Telemetry Failures & Orchestrator Surfacing** (`modules/notebooklm/ingest-notebooklm.sh`, `core/run-all.sh`): Telemetry writes mark success only after atomic rename succeeds, and `core/run-all.sh` surfaces telemetry failure details when target exits non-zero.

## [0.1.2.0] - 2026-08-08

### Added
- **KB-Sync Directed Graph & Structural DAG** (`core/dag.mjs`, `scripts/build-dag.mjs`, `schemas/*.v2.json`): Machine-readable `dag.json`/`adjacency.json` graph builder with crash-consistent generation directories, atomic doc/pointer commits, recovery scan, and GC retention. See `docs/meta/specs/2026-08-08-kb-sync-dag-design.md`.
- **Weekly Review Capacity Telemetry Workflow** (`.github/workflows/weekly-review-capacity.yml`): Staged scheduled telemetry workflow running `npm run kb:review-metrics` in the `kb-sync` repository.
- **Workflow Validation Test Suite** (`tests/weekly-review-capacity-workflow.test.ts`): Updated path resolution to validate workflow configuration at `kb-sync` repository root.

### Fixed
- **DAG builder determinism** (`core/dag.mjs`, `scripts/build-dag.mjs`): `cycles_count` was hardcoded to 0 (now computed via Tarjan's SCC); `created_at` used wall-clock time, breaking cross-run bit-identical output (now derived from git commit time, with `SOURCE_DATE_EPOCH` override); `generation_id` didn't match the documented `YYYYMMDD_HHMMSS_<hash8>` format.
- **notebooklm-sync-verification.ts**: Test 7's minimal-PATH simulation hid `git` on Windows Git Bash (MSYS2), causing the sync script to fail at `git rev-parse` (exit 127) before reaching its own CLI-availability check (exit 1).

### Changed
- **Incremental Delta Sync Engine** (`modules/wiki/detect-drift.js` & `modules/wiki/detect-drift.ts`): Integrated SHA-256 file hash diffing into `_kb-sync-staging/` to package only changed and added source files during scheduled and manual runs.
- **Obsidian Target Documentation** (`docs/targets/obsidian.md`): Updated target schema documentation with incremental delta staging modes and atomic lock specifications.

## [0.1.1.0] - 2026-08-06


### Added
- **Incremental Delta Sync Engine** (`modules/wiki/detect-drift.js` & `modules/wiki/detect-drift.ts`): Integrated SHA-256 file hash diffing into `_kb-sync-staging/` to package only changed and added source files during scheduled and manual runs while maintaining 100% downstream consumer compatibility through materialized complete snapshot trees.
- **Atomic Concurrency Lock (`acquireLock`)**: Exclusive file creation (`flag: "wx"`) with race-protected stale lock recovery (>10 min) prevents simultaneous staging runs.
- **Strict Snapshot Validation (`validateSnapshot`)**: Complete manifest validation rejecting non-regular files, directories, and symlinks before selecting a prior snapshot.
- **Platform-Aware Atomic Publication (`safeRenameSync`)**: Temp directory materialization followed by atomic rename with lock-retry fallback on Windows OS.
- **Incremental Delta Unit Test Suite** (`tests/incremental-delta-sync.test.ts`): 8 comprehensive tests covering path sanitization, baseline materialization, incremental delta reuse, zero-change runs, `--full` mode, corrupt baseline recovery, concurrency lock error rejection, and stale-lock recovery.

### Changed
- `modules/obsidian/ingest-obsidian.sh`: Added `--incremental` vs `--full` flag parsing with conflict validation (exit code 2) and single-pass `node detect-drift.js` materialization execution.
- `schedule-task-wrapper-KB-Sync-Stage-Sources.ps1`: Configured scheduled tasks to set `$env:INCREMENTAL_SYNC = "1"` and pass `--incremental`.
- `tests/obsidian-sync-verification.ts`: Enhanced Git Bash executable resolution on Windows with conflict flag validation test (Test 5).
- `package.json`: Added `kb:sync:obsidian:incremental`, `kb:sync:obsidian:full`, and `test:incremental` npm scripts.

## [0.1.0.0] - 2026-08-05

### Added
- **Obsidian Wiki Synthesis Worker** (`modules/obsidian/synthesize-wiki.ts`): Headless synthesis engine that ingests staged Obsidian vault content, invokes a pluggable provider, validates proposals against the canonical wiki contract, and promotes accepted pages into the live wiki via a journaled, crash-recoverable transaction.
- **Provider plugin system** (`modules/obsidian/providers/`): Extensible provider interface with three built-in implementations:
  - `AnthropicProvider` — calls Claude API to synthesize wiki pages; fails closed when `ANTHROPIC_API_KEY` is absent.
  - `LocalProvider` — connects to a local LLM endpoint; blocks remote endpoints by default for security.
  - `OfflineTemplateProvider` — generates `draft:true` / `status:active` scaffolded pages without any API calls.
- **Journaled Recoverable Promotion (Phase 13)**: Snapshot backup written before any live-wiki mutation; recovery manifest records session state; crash recovery on next startup restores marked backups and quarantines unmarked/invalid ones.
- **Phase 5 Contract Validator integration**: Transaction workspace validated via `validate-contract.mjs` before any live-wiki write; validation failure leaves vault untouched and Log.md unmodified.
- **Proposal schema validation**: Enforces canonical `category` / `status` values, `kb-sync/` path prefix, `.md` extension, absence of `..` path traversal, and citation-to-manifest cross-reference before promotion.
- **Synthesis worker verification suite** (`tests/synthesize-worker-verification.ts`): 9 end-to-end tests covering offline-template provider, loopback security, AnthropicProvider fail-closed, journaled promotion with fixture vault, idempotency hash guard, contract-failure quarantine, and crash-recovery fixture.
- **Harness safeguard verification suite** (`tests/harness-safeguards-verification.ts`): Tests for `isBashAvailable()` guard, CI-blocking policy on missing Bash coverage, and platform-specific benchmark threshold behavior.

### Changed
- `modules/obsidian/ingest-wiki.sh`: Updated staging script for synthesis worker integration.
- `docs/targets/obsidian.md`: Extended schema documentation with synthesis worker fields and operator workflow.
- `modules/wiki/operator-workflow.md`: Updated operator runbook to include synthesis worker invocation steps.
- `modules/wiki/schema.md`: Aligned wiki schema with synthesis worker canonical contract (categories, statuses, `draft:true` field).
- `tests/core-scripts-verification.ts`: Added `isBashAvailable()` guard — skips Bash-dependent tests with `[SKIP] DEGRADED` when Bash is unavailable; emits `REQUIRE_BASH_COVERAGE` CI policy block when environment variable set.
- `tests/obsidian-sync-verification.ts`: Updated staging script test for Windows/Bash compatibility handling.
- `tests/performance-benchmark.ts`: Added platform-specific baselines (`win32Ms` multiplier) with documented thresholds; reports Windows performance separately.
