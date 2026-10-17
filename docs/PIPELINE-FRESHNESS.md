# Documentation pipeline: freshness, identity and honest status

This describes the **existing** pipeline (source → entity synthesis → wiki contract validation → GitHub-wiki publish
→ SQLite/FTS5 cache) and the single command that runs it end to end. It adds no scheduler, wiki platform or store.

## The one command

```bash
npm run kb:pipeline:e2e                    # local stages; publication NOT requested  -> LOCAL_ONLY when green
npm run kb:pipeline:e2e -- --publish       # also pushes the wiki and verifies the remote head -> HEALTHY when green
npm run kb:pipeline:status                 # read-only: is what exists current? (exit 0 only if HEALTHY/LOCAL_ONLY)
```

Useful flags: `--json`, `--force` (ignore resumable stages), `--require-published` (status: LOCAL_ONLY is not enough),
`--repo-root`, `--db`, `--remote-url`, `--max-receipt-age-hours`, `--semantic <provider>` (opt-in; see "Labelling").
The existing Windows `KB-Sync-Master` wrapper and the CI workflow both call that same command (see "Automation wiring"); do not add a second
scheduler. Re-running is restart-safe: state is written atomically to `.pipeline-state.json` (an interrupted run is
reported `IN_PROGRESS`, never healthy) and `.pipeline.lock` blocks concurrent runs (stale pid locks are taken over).

## Stages and what each status means

| Stage | Meaning | Evidence |
|---|---|---|
| `source_checked` | Source inputs hashed (repo + full relative path + sha256). | `sources_hash` |
| `generation_complete` | Every source read; pages written atomically. Any unreadable source = failure, **no partial output**. | `wiki/.generated-manifest.json` |
| `content_validated` | Generated pages match the manifest and the **current** source bytes, and the existing wiki contract validator passes. | recomputed from disk, not from the run |
| `publication_prepared` | A publish tree was built in a temp dir with the publisher's existing secret-scan gate; every entity page is present. Nothing remote is touched. | `PREPARED_NOT_PUSHED` |
| `indexing_complete` | FTS5/vector cache contains the current page bytes. | sha compare in `kb_documents` |
| `publication_verified` | Pushed **and** the remote head was read back and matches. Only with `--publish`. | `.wiki-sync-receipt.json` |

Overall: `HEALTHY` (publish mode, all ok) · `LOCAL_ONLY` (no `--publish`; local stages ok, publication explicitly
not verified) · `DEGRADED` (stale/unverifiable evidence) · `FAILED` (a required stage failed; downstream stages are
not run) · `IN_PROGRESS`.

## Identity

Generated page ids come from `repository + full relative source path` plus a short hash
(`entityPageId` / `entityPageRelPath` in `modules/wiki/entity-synthesizer.ts`), so `src/a/index.ts` and
`src/b/index.ts` can no longer overwrite each other. Legacy basename paths are kept as manifest-owned alias pages (or
disambiguation pages when ambiguous) so existing links keep resolving. GitHub wiki URLs are flat: a flat basename copy is
published only when unambiguous (`planFlatCopies`); nested paths are always published.

## Freshness

A receipt establishes freshness only if `evaluateReceiptFreshness` (`modules/wiki/cross-repo-drift-scanner.ts`)
passes: status `SYNCHRONIZED`, same repository, not future-dated, younger than the max age (48 h default),
`revision == current HEAD`, and a non-empty `remote_wiki_head`. Anything else is `STALE_RECEIPT` and degrades the
result. The publisher no longer writes `SYNCHRONIZED` unless the push succeeded and the remote head was verified;
a prepare-only run writes no receipt and never overwrites the last real one.

## Removed and renamed sources

Generated output is owned through manifests (`wiki/.generated-manifest.json`, and `.kb-sync-published-manifest.json`
in the published wiki checkout). A file is removed only if a manifest recorded it **and** its current sha equals the
recorded sha. Human-authored pages, unknown files, edited generated pages (carried as `orphanedEdited`), a missing or
corrupt manifest, and paths escaping the root are never deleted (`modules/wiki/generated-ownership.mjs`).

## Labelling

Entity pages are a **metadata inventory** (`generationKind: metadata-inventory`, `semanticContent: false`). A normal
run reports `semantic_regeneration: not_performed`. Only `--semantic <provider>` runs the existing
`modules/obsidian/ingest-wiki.sh` path (the `offline-template` provider produces template drafts, not LLM prose).

## Automation wiring

Both entry points call the one command above; neither adds a scheduler.

- **CI** (`.github/workflows/wiki-drift-and-publish.yml`): after drift detection and the contract check, `pull_request`
  runs `npm run kb:pipeline:e2e` (local stages only). `push` / `schedule` / `workflow_dispatch` run
  `npm run kb:pipeline:e2e -- --publish`, with the token URL passed through the `WIKI_REPO_URL` environment variable (never
  on a command line). Nothing is published from `pull_request` events. The step exits non-zero, failing the job, unless
  the result is `HEALTHY`. Publishes are serialized with a `concurrency` group. `.pipeline-state.json` is uploaded with the
  other telemetry artifacts.
- **Windows** (`scripts/schedule-task-wrapper-KB-Sync-Master.ps1`, the script the existing `KB-Sync-Master-Pipeline`
  scheduled task runs): new `STAGE 2B` runs `npm run kb:pipeline:e2e` after Stage 2 and before NotebookLM ingestion. A
  non-zero exit (`FAILED`, `DEGRADED`, `IN_PROGRESS`, or a lock held by a live run) sets the wrapper's overall status to 1,
  which triggers the existing critical alert. **Publishing is opt-in:** set the machine/user environment variable
  `KB_PIPELINE_PUBLISH=1` for the task to add `--publish`. Without it the wrapper never pushes, so the local
  `.wiki-sync-receipt.json` ages out (48 h) and the drift audit will report `STALE_RECEIPT` unless CI or a manual
  `--publish` run refreshes it. The scheduled task definition itself is unchanged.
- The pipeline names generated pages after the checkout directory name (`repoName` = basename of the repo root). Both
  entry points run in a directory named `kb-sync`; a differently named checkout produces a different repository identity
  (and a receipt for another name is reported as `RECEIPT_REPOSITORY_MISMATCH`).
## Not covered / needs runtime verification

- Remote GitHub wiki push (tests use local bare repos only).
- The first CI run of the new workflow steps (the PR run exercises the local stages on Linux; the publishing step only runs
  on push/schedule/dispatch), and the first scheduled run of the updated wrapper. Both were validated here only by static
  tests (`tests/pipeline-freshness.test.ts` tests 10-11) and a local Windows run; no scheduled task was run or changed.
- Dense vector (`kb_vectors`) freshness depends on the existing embedding step; only FTS5/sha currency is asserted.
- Test: `npm run test:pipeline-freshness`.
