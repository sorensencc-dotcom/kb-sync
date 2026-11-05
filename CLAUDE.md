---
title: "Claude Code Guidelines"
category: "guidelines"
status: "active"
---

# kb-sync

## What this repo is

`kb-sync` is the CIC Knowledge Base Sync Pipeline. It stages raw sources, packs them for NotebookLM, and builds an Obsidian/GitHub wiki. It also runs the TRM (Topic Research Matrix) research loop and a local SQLite context cache that an MCP server exposes.
The stack is Node.js with TypeScript (run through `tsx`), Bash and PowerShell. Orchestration is fail-soft, so one failing target does not block the others.

## Where things live

- `README.md`: overview of the core systems (TRM pipeline, competitor watchlist, SQLite cache, MCP server).
- `core/`: orchestration. `run-all.sh` (master orchestrator), `flatten.sh`, `chunk.sh`, `validate.sh`, `rollback.sh`, `targets.mjs`, `config-loader.mjs`, `path-normalizer.mjs`.
- `configs/`: YAML policy. `global.yaml`, `notebooklm.yaml`, `obsidian.yaml`, `artifact-generator.yaml`, `compaction.yaml`, `webhooks.yaml`.
- `modules/notebooklm/`: `ingest-notebooklm.sh`, `push-source.sh`, `session-health-check.mjs`.
- `modules/obsidian/`: `ingest-obsidian.sh`, `ingest-wiki.sh`, `synthesize-wiki.ts`, `providers/`.
- `modules/wiki/`: wiki synthesis and validation. `schema.md`, `lint-rules.md`, `update-rules.md`, `operator-workflow.md`, `templates/`, `pipeline-runner.ts`, `validate-contract.mjs`, `validate-staging-docs.mjs`.
- `modules/artifact-generator/`, `modules/compactor/`, `modules/cache/`, `modules/trm/`, `modules/healing/`, `modules/graph-sync/`, `modules/review-capacity/`: other pipeline modules.
- `scripts/`: Node and PowerShell entry points. Examples: `check-status.mjs`, `consolidate-pack.mjs`, `generate-wiki-index.mjs`, `sync-kb-cache.mjs`, `kb-file-answer.mjs`, `kb-content-lint.mjs`, `trm-triage.mjs`.
- `scripts/mcp-memory-server.mjs`: MCP server over the SQLite cache. The cache DB is `.kb_cache/knowledge.db`, and the pipeline generates it.
- `wiki/`: generated wiki. `Index.md`, `Home.md`, `Log.md`, `concepts/`, `entities/`, `research/`, `specs/`.
- `docs/`: `targets/` (`notebooklm.md`, `obsidian.md`), `governance/` (`automation-policy.md`, `skill-approval-rules.md`), `operations/`, `skills/`, `PIPELINE-FRESHNESS.md`.
- `skills/html-visual-verify/`: the only in-repo skill (source plus tests).
- `tests/`: custom verification tests (`*.test.mjs`, `*.test.ts`, `*-verification.ts`). Most run with `node --test` or `npx tsx`.
- `.github/workflows/`: `test-suite.yml`, `secret-scan.yml`, `validate-staging.yml`, `wiki-drift-and-publish.yml`, `weekly-review-capacity.yml`.
- `.nlm_pack/` (generated) and `_kb-sync-staging/` (immutable staging) are outputs. Never hand-edit them.

## Build and test

There is no build step and no linter. Scripts are defined in `package.json`.

- `npm test` runs `npm run test:all`, the full suite.
- `npm run test:core`: core scripts.
- `npm run test:obsidian`: Obsidian sync and wiki synthesis.
- `npm run test:notebooklm`: NotebookLM sync.
- `npm run test:path`: path normalizer.
- `npm run test:wiki-index`: wiki index generator.
- `npm run test:pipeline-freshness`: pipeline freshness.
- `npm run test:kb-file-back-lint`: file-back and content lint.
- `npm run test:manifest`, `test:harness`, `test:worker`, `test:incremental`, `test:perf`: other suites that `test:all` includes.
- `npm run secret-scan`: secret scan.
- `npm run kb:pre-flight`: `test:all` plus `wiki:validate-contract`.

Sync and status:

- `npm run kb:status`: sync status.
- `npm run kb:sync:all`: all targets (`core/run-all.sh`). Use `kb:sync:all:rollback` to revert.
- `npm run kb:sync:notebooklm` and `npm run kb:sync:obsidian`: individual targets. Both have `:rollback` or `:incremental`/`:full` variants.
- `npm run kb:pipeline:e2e` and `npm run kb:pipeline:status`: end-to-end wiki pipeline and its status. The e2e run regenerates `wiki/Index.md`.
- `npm run kb:pipeline:trm`: TRM staging validation, offline synthesis, contract validation, cache sync.
- `npm run wiki:validate-contract` and `npm run wiki:validate-staging`: wiki validation.
- `npm run wiki:index`: regenerate `wiki/Index.md`.
- `npm run kb:cache:sync`: rebuild the SQLite cache from the wiki.
- `npm run kb:lint`: content lint. `npm run kb:file-answer`: file a verified answer back into the KB.

Several scripts call `powershell.exe` (for example `kb:sync` and `trm:triage:daily`). Those only work on Windows. Some `bot:*` scripts call `../scripts/`, which lives outside this repo.

## Knowledge lookup

Before answering a question about this project, look it up in the KB first. Cite the file path you used.

1. Start with `wiki/Index.md`. It is generated from `kb_documents` (do not edit it) and links to per-category indexes: `wiki/index-research.md`, `wiki/index-gap.md`, `wiki/index-audit.md`, `wiki/index-source.md`.
2. For cross-repo lookup, use the `kb-sync` MCP server. Call `query_context_cache` to search, then `fetch_topic_note` to read a note in full.
3. Fall back to the repo docs. `docs/targets/obsidian.md` is the canonical vault schema, and `docs/governance/automation-policy.md` covers policy.
4. If the KB has nothing, say so rather than guessing.

## Procedures

- Wiki synthesis: follow `modules/wiki/operator-workflow.md`. The rules are in `modules/wiki/schema.md`, `modules/wiki/lint-rules.md` and `modules/wiki/update-rules.md`. Operators drive synthesis. Do not auto-update the wiki.
- Obsidian wiki ingest: `docs/skills/obsidian-ingest-wiki.md`. Its entry point is `modules/obsidian/ingest-wiki.sh`, run through `npm run wiki:ingest:obsidian:validate` or `npm run wiki:ingest:obsidian:prompt`.
- Skill approval and automation limits: `docs/governance/skill-approval-rules.md` and `docs/governance/automation-policy.md`.
- Pipeline freshness: `docs/PIPELINE-FRESHNESS.md`.
- Nightly audit: `docs/operations/kb-sync-nightly-audit.md`.
- NLM pack count check: `docs/operations/nlm-pack-count-check.md`. Run it with `npm run nlm:pack-count`.
- NotebookLM target: `docs/targets/notebooklm.md`.
- Task Scheduler setup: `docs/task-scheduler-setup.md`.
- Cross-platform testing: `docs/CROSS_PLATFORM_TESTING.md`.
- Review and open work: `REVIEW.md`, `TODOS.md`, `STATUS.md`.
- Visual verification: `npm run visual:verify` (source in `skills/html-visual-verify/`).

## Rules

- Staging is immutable. Add new stagings. Never edit old ones.
- Generated files (`wiki/Index.md`, `.nlm_pack/`, `.kb_cache/`, `.sync-status.json`) are not hand-edited.
- Keep one failing target from blocking the others. Do not remove the fail-soft behavior.
- Use absolute paths in scripts. Use environment variables only for vault root overrides, for example `OBSIDIAN_VAULT_ROOT`.
- Architecture changes (Tier 1) need approval. Tier 0 changes auto-install on merge.
