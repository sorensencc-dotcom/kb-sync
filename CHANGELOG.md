# Changelog

All notable changes to this project will be documented in this file.

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
