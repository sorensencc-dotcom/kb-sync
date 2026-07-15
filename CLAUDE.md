# kb-sync Project Context

**Stack:** Node.js / TypeScript / Bash  
**Architecture:** Multi-target KB sync pipeline (modular, fail-soft orchestration, immutable staging)  
**Entry:** `npm run kb:sync:all` | individual: `npm run kb:sync:notebooklm`, `npm run kb:sync:obsidian`  
**Tests:** TypeScript verification (tsx runner) | `npm run test:all`  
**Lint:** None configured  

## Structure

- `core/` — Orchestration: run-all.sh, flatten.sh, chunk.sh, validate.sh, rollback.sh
- `modules/notebooklm/` — NotebookLM ingest + post-commit hook
- `modules/obsidian/` — Obsidian vault sync (ingest + wiki validation/prompt generation)
- `modules/wiki/` — Wiki synthesis: schema, lint-rules, update-rules, templates
- `modules/artifact-generator/` — Artifact generation from packs
- `configs/` — YAML: global.yaml, notebooklm.yaml, obsidian.yaml, artifact-generator.yaml
- `obsidian/vault/` — Local Obsidian vault root
- `docs/` — Governance, target specs, skill docs
- `tests/` — Verification tests (custom TypeScript, no Jest)
- `.nlm_pack/` — Output: consolidated KB (generated)

## Patterns

- **Orchestration:** Bash wrappers call npm scripts; core/run-all.sh invokes SYNC_TARGETS fail-soft
- **Immutable staging:** Raw sources → `_kb-sync-staging/<repo>/<timestamp>/` (audit trail, never edited)
- **LLM wiki synthesis:** Manual 8-phase (Ingest→Lint→Update→Cross-Ref→Lint→Log→Review→Commit)
- **Config-driven:** YAML per-module (repo_path, output_dir, skip patterns); global.yaml centralizes
- **Rollback:** Each target supports `--rollback` to revert
- **Path handling:** All paths absolute; env vars only for vault_root overrides
- **Output format:** `.nlm_pack/` directory (pyragify.yaml rules)

## Key Files

- `package.json` — npm run scripts (entry points for all sync + tests)
- `core/run-all.sh` — Master orchestrator; lists SYNC_TARGETS
- `pyragify.yaml` — NLM pack config (skip rules, file extensions)
- `configs/global.yaml` — Global policy (all scripts reference)
- `modules/obsidian/ingest-wiki.sh` — Staging validation + prompt generation
- `docs/targets/obsidian.md` — Three-layer vault schema (canonical)
- `modules/wiki/operator-workflow.md` — 8-phase synthesis workflow

## Principles

- **Immutable staging:** Raw sources frozen in time; only new stagings allowed
- **Human-in-loop:** No auto wiki updates; operators drive synthesis via Claude
- **Fail-soft:** One target failing doesn't block others; all continue
- **Deterministic:** Bash sequences, versioned configs, manifest audit trails
- **Governance:** Tier 0 (auto-install on merge); Tier 1 (arch changes need approval)
