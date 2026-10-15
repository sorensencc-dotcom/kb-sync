# Session status

Updated: 2026-10-14

Goal: Implement and verify approved kb-testing sandbox refactor without touching production notebooks or unrelated checkout changes.

Implementation:
- Isolated worktree from 86caffacc870ed8a2647d8f4e197f70e433d1da7; branch codex/kb-testing-live-sandbox.
- Registered exact sandbox, excluded it from historical master packs and unfiltered scheduled chat runs, and added three entity-specific questions.
- Sandbox queries require the exact pinned fixture and use persistent server conversations. Raw metadata and logs stay in isolated evidence paths; production log format stays unchanged.
- Live ingest verifies returned upload ID and ACTIVE status before receipting, including same-title old/new sources.
- Protected fixture across shared JavaScript and shell deletion paths. Replacement uses actual closed-loop entrypoint, run-owned ID journals, upload verification, ACTIVE status, and at least 3.5 seconds before deleting old owned sources.
- Preserved existing production replacement flag behavior and uploaded-pack grounding semantics. Added actual sandbox Stage 1.5 plus separate owned-pack citation verification through shared production attribution helper.
- Live tests reject inherited mock overrides, preserve failed evidence, clean only owned IDs in finally, and verify exact before/after source inventory.

Verification:
- Focused offline suite: 61 passed, zero failed, four live cases skipped without opt-in. Hard timeouts enforced. Windows shell guard passed outside restricted sandbox after runtime startup failed inside sandbox.
- Latest real runner queried ALPHA-101, BRAVO-202, and CHARLIE-303. All required facts passed; all citations/references point only to fixture; exact returned questions and answers appear in remote transcripts. Independent retained-evidence audit passed all three turns.
- Query evidence: node_modules/.cache/kb-testing-final-20261014-01/; interrupted later mutation phase remains documented by process-result.json and verified owned-source cleanup receipt.
- Final mutation/grounding rerun: three tests passed, zero failed, in 106.946 seconds. Actual ingest uploaded one source, read server marker, wrote matching receipt, and skipped repeat upload.
- Failed replacement upload retained old source. Successful replacement verified ACTIVE, waited 5,672 ms, then deleted only old owned source. Uploaded-pack answer cited exact new source and unique run marker.
- Actual Stage 1.5 passed pinned-fixture grounding. Final source inventory restored sole fixture cc06bd53-1793-4ea0-b723-6f77eb1dd490, ACTIVE/status 2.
- Mutation evidence: node_modules/.cache/kb-testing-final-20261014-02/console.log, process-result.json, replacement.json, ingestion-first.json, ingestion-second.json, uploaded-pack-grounding.json, stage1.5.json, and cleanup-source-list.json.
- Reviewed and corrected earlier live holes: ephemeral --new-conversation sessions invisible remotely, missing CHARLIE citations, valid 3.5-second wording rejected, lost orchestrator stdout failure details, same-title receipt mismatch, ownership journal fallback, stale-answer transcript assertions, production response duplication, and buffered test progress.

Delivery: Implementation committed as cbbf9d0b on codex/kb-testing-live-sandbox, prepared for remote review. Exact delivered SHA and remote verification appear in final chat. No merge, deployment, production notebook execution, or fixture changes.

Existing hook results: Markdown, contract, secret, and fail-soft sibling checks completed. Sibling gate logged 12 wiki siblings for regeneration. Post-commit autoheal reported 81 stale wiki pages, then aborted on schema validation; it stated target vault and Log.md remained untouched. Generated TODO and graph/cache-ignore state remain local, excluded from scoped commit.

Next action: Review delivered branch for merge. Wiki regeneration/schema remediation remains a separate follow-up.

Not checked: full unrelated kb-sync suite or remote CI. Raw live receipts remain ignored local artifacts; commits contain code, tests, configuration, and this status only.

Follow-up verification, 2026-10-14:
- Read-only live inventory for Agent Harnesses notebook 359b346c-6af7-4ba3-baef-b985c9e6e1af confirms 14 sources, all ACTIVE/status 2: eight pack chunks (aa, ah, ai, aj, al, am, an, ao) and six other sources. All seven operator-supplied deleted source IDs are absent.
- Missing-title-only retry claim does not match current code. Nightly PowerShell calls modules/notebooklm/ingest-notebooklm.sh, which uploads every generated chunk, waits for new sources, and then purges preexisting pack sources. That shell script is unchanged between canonical 86caffac and delivered a0278744.
- Separate ingest-nlm-runner.mjs skips by local notebook/file/hash receipts, without reconciling remote deletion before skip. Deleting remote stubs alone does not guarantee reupload through that path either.
- Safe selective repair requires generation/content-aware reconciliation of remote source IDs and ACTIVE state before deciding which chunks to skip. No production upload, deletion, receipt change, schema patch, cleanup, or merge executed during this follow-up.
- Pasted merge instructions name old working branches rather than delivered codex/kb-testing-live-sandbox branches and include destructive canonical-checkout cleanup. Treat them as unreviewed suggestions; preserve existing work.

Investigation and regression probes, 2026-10-14 (offline):
- P1 multipart data loss reproduced through actual shell: Step 0 treats distinct chunk titles as duplicate packs. Eight ACTIVE chunks become one before first upload. Forced first-upload failure leaves seven deleted; FAILED telemetry reports purged_sources=0. Successful 15-part replacement reports only final deletion, omitting seven preflight deletions. Standalone --repair-drift also deletes seven of eight healthy chunks without uploading.
- Multipart harness: five characterization cases passed, using 58 MiB synthetic input and unchanged production 8 MB hard threshold / 4M splitting. Single-old upload failure preserves old source; ERROR-state batch removes fifteen new sources and preserves old plus six unrelated. All CLI calls mocked, each shell invocation bounded to 60 seconds. Evidence: node_modules/.cache/multipart-investigation-20261014-probe/results.json and probe.mjs.
- Receipt harness: five scenarios, four desired-behavior gaps, one desired pass, zero execution errors. Deleted/FAILED receipt sources skip without remote listing. Fifteen receipts with seven missing sources skip all fifteen. No receipts with eight healthy sources uploads all fifteen, leaving 23 sources/eight duplicate titles; title-only verification binds first eight fresh receipts to older source IDs. Changed-content control uploads once and skips unchanged control. Evidence: node_modules/.cache/receipt-reconciliation-investigation-20261014-agent/report.json and harness.mjs.
- Wiki probes: fifteen desired-behavior/control assertions, six passed and nine failed. Both autoheal implementations strip quotes from colon-bearing titles (invalid YAML), drop block tag arrays, coerce quoted version strings to numbers, and leave concepts/completed metadata invalid. Synthesis rejects research/draft accepted by validator (extracted actual proposal function, not full synthesis pipeline). Evidence: node_modules/.cache/wiki-investigation-20261014/probe.mjs, probe.log, and schema-probes.json.
- Pasted schema diagnoses partly disproved: manifest-version regex already excludes trailing space; numeric YAML version, YAML date fields, and inline tag arrays pass current controls. Do not apply proposed schema rewrite as written.
- Existing tests/validate-contract-json.test.js: two passed. Vitest schema/autoheal suites could not start because vitest is absent. Existing thirteen-case shell suite completed first six cases, then hard timeout at case seven; no full-suite pass claimed. Windows restricted runtime required escalated execution for isolated probes resolving dependency junction.
- Diagnostic evidence is ignored and local. node_modules is a junction to canonical dependency directory; source reads explicitly target isolated worktree. No product fixes, dependency installs, production calls, merges, or unrelated generated changes made.
- Next repair priority: prevent pre-upload deletion of multipart generations; reconcile receipts with exact ACTIVE remote IDs/content before skipping; bind receipts to returned upload IDs; preserve YAML with installed parser/serializer and align existing enum consumers without broadening governance.
- Prior sandbox live passes do not establish production multipart safety. Avoid normal sync/repair-drift for the eight healthy production chunks until replacement ordering is fixed and independently retested.

Root-cause repair contract, 2026-10-14 (operator invoked principle-fix-root-causes):
- Operational scope: isolated delivered branch only; preserve unrelated dirty work. No production notebook writes, merges, schema-enum expansion, or canonical vault repairs.
- Replacement acceptance: preserve every old multipart chunk until all replacement IDs are ACTIVE; fail closed on unverifiable status; never use list order to collapse distinct chunks; failed/partial upload preserves old coverage; cleanup telemetry reflects actual deletes.
- Receipt acceptance: skip only unchanged content with an exact receipt source ID currently ACTIVE in the same notebook; missing/FAILED IDs retry; new receipts bind returned new IDs; title alone never proves content identity. Do not adopt unreceipted sources by title.
- Wiki acceptance: installed YAML parser/serializer preserves title, arrays, version types, and unknown fields across both sweepers; reject malformed/unsupported metadata without destructive rewrite; synthesis uses existing validator category/status contract without changing allowed values.
- Verification: executable regression tests first, bounded offline suites, independent review, then dispatch sandbox-only live tests when each mutation path is ready. Commit/push scoped files only; retain exact evidence and limits.

QA-only checkpoint, 2026-10-15:
- Scope changed to report-only via explicitly invoked gstack-workflows:qa-only; no product code/config edits, implementation commits, pushes, merges, or deployments during QA. Earlier root-cause fixes remain local/uncommitted; HEAD remains 9bca87a4.
- 102 focused Node checks passed; ten actual-shell multipart cases passed individually with normalized Windows PATH; fifteen polling assertions passed. Existing thirteen-case shell suite completed 1-6, then failed at case seven because malformed preflight inventory exits without writing FAILED telemetry; 8-13 not reached.
- Actual sandbox ingestion/readback/idempotency/deleted-source recovery/repeat skip passed in 98.20 seconds. Final exact source inventory restored sole ACTIVE pinned fixture. Independently cleaned the prior interrupted run's exact recorded owned ID before rerun; cleanup receipts retained.
- Read-only production inventory remains fourteen ACTIVE sources, including eight healthy chunks aa, ah, ai, aj, al, am, an, ao. No production source was uploaded or deleted.
- QA HOLD: optional live closed-loop production entrypoint still deletes old sources after upload command success without ACTIVE proof; normal shell preflight errors omit FAILED telemetry; contradictory duplicate receipt source IDs still produce successful skip; multipart test Windows PATH construction is not portable without environment normalization.
- Report and exact logs: node_modules/.cache/qa-only-root-causes-20261015/QA-REPORT.md. Live receipts: node_modules/.cache/root-causes-receipt-20261015-qa01/. No full unrelated suite, remote CI, live multipart shell, or production-scale upload approval. Agents stopped on usage limits; preserve all current local work.

Root-cause repair continuation, 2026-10-15:
- Closed-loop live path now retains old pack sources until returned upload ID is uniquely present and ACTIVE, waits 3.5 seconds, then deletes old IDs through shared replacement code.
- Normal and standalone shell preflight failures now publish FAILED telemetry before exiting; old SUCCESS telemetry cannot remain the reported result.
- Receipt source listing rejects malformed entries and duplicate IDs before skip/upload decisions; regression covers contradictory same-ID ACTIVE/FAILED inventory.
- Multipart child environment now normalizes Windows PATH casing before adding Git directories. Full shell ingestion suite passes all 13 cases.
- Focused receipt and replacement-gate tests pass 48/48. Authorized sandbox live suite passes 4/4, including failed-upload retention, ACTIVE gating, 3.5-second pacing, idempotency, and Stage 1.5 grounding. Multipart Node harness remains unverified because Git Bash child launch returns host status 3221225794 under node spawnSync.
- No production notebook mutation, merge, deployment, commit, or push performed.
- Full local gate reached `test:manifest`; six manifest cases passed and its Bash E2E case failed before product logic with host status `3221225794`. Remaining non-Bash gates passed: core/obsidian completed DEGRADED with Bash checks skipped, incremental, worker, harness, v1.2 features, contract cleanup, path, and performance passed.
- Closed-loop production mutation now requires `NLM_PRODUCTION_MUTATION_APPROVED=1` in addition to the existing live gate; sandbox live behavior remains unchanged.
- Remote CI remains unverified because local fixes are uncommitted; branch remote still points to `9bca87a4`.

Hook repair, 2026-10-15:
- Isolated branch codex/hook-repair-20261015 from 4e340105; preserve ongoing ingestion work in separate checkout.
- Contract schema errors now identify offending note, field, and value with both AJV error-path formats. Existing schema remains unchanged.
- Drift hooks retain complete failure logs under Git metadata and print retained path. Installer resolves shared hook directory from linked worktrees.
- Verification: 21 focused hook and metadata-preservation tests passed; three notification-bridge checks passed. Real notifier handled 1 MB stdin through bounded session/turn identity. Git Bash and Node-to-Bash probes pass with host access; restricted runner returns DLL initialization status 0xC0000142.
- Global Git AI executable restored to configured path from official v1.7.5 release; published SHA256 verified. Empty-payload smoke launched successfully; it reported missing cwd, so this does not prove attribution capture.
- Global Stop/Interrupt bridge installation was rejected by automatic approval review pending explicit human approval. Existing global configuration and notify command remain unchanged. Proposed hook JSON and bridge source: node_modules/.cache/hook-repair-20261015/.
- Source vault validation still fails for 64 of 444 notes, including unsupported research statuses. No canonical vault edits, schema relaxation, or installed shared-hook overwrites performed.
- Next action: approve global hook installation, review/trust new definitions through Codex /hooks, then retire legacy notify only after replacement is trusted. Review source-vault metadata mappings before remediation.
- Limits: focused checks only; full unrelated suite and live attribution capture not verified. Repository diagnostics require normal delivery before installed hooks gain updated behavior.

Hook repair delivery checkpoint:
- Commit 1310c3f5 contains five scoped files; normal pre-commit checks passed. Existing post-commit autoheal still rejected invalid source-vault metadata and reported vault/Log.md untouched.
- Push to https://github.com/sorensencc-dotcom/kb-sync branch codex/hook-repair-20261015 was rejected by automatic approval review because private-code egress requires explicit destination approval. No remote delivery occurred.
- Global hook installation remains separately pending human approval. Do not retry either rejected action without approval. Preserve generated local TODOS.md change.
- Retrospective: restricted Bash DLL startup differs from host behavior; stdin bridge removes argv-size failure; AJV v6 dataPath and verbose error values restore actionable diagnostics; linked worktrees require git-common-dir for effective hook installation.

Global hook installation approved and completed, 2026-10-15:
- Human explicitly approved Stop/Interrupt hook installation. Installed tested computer-use-turn-ended.cjs plus exact proposed definitions in user hooks.json; backup hooks.json.before-repair-20261015 retained. All previous hook definitions match backup exactly.
- Installed Stop and Interrupt handlers each passed real-notifier smoke with synthetic IDs and 1 MB stdin. Codex hook trust state remains untouched; operator must review/trust new definitions through /hooks before activation.
- Legacy notify remains configured until replacement trust is confirmed. GitHub push approval remains absent; commit 1310c3f5 remains local. Existing vault metadata blockers remain unresolved.

Remaining hook repairs, 2026-10-15:
- Recorded human trust now exists for installed Stop/Interrupt handlers. Retired legacy notify by setting notify=[] with backup config.toml.before-notify-retirement-20261015; semantic comparison confirmed all other TOML unchanged.
- Corrected earlier source-vault diagnosis: canonical C:/dev/kb-sync/obsidian/vault/wiki validates 6,442 notes with zero failures. The 64 failing documents belong to legacy C:/dev/wiki, selected by committed C:/dev fallback when worktrees lack .env.
- Changed committed vault_root default to obsidian/vault, relative to current checkout. Explicit environment/.env overrides remain intact. No canonical research metadata rewrite or schema change required.
- Regression proof: old C:/dev default fails both routing cases; corrected default passes. Focused suite passes 23 tests, including real TS/JS drift resolvers and synthesis entrypoint with explicit override.
- Code remains on local codex/hook-repair-20261015. GitHub push still requires explicit destination approval after earlier automatic review rejection.

PR #40 conflict resolution, 2026-10-15:
- Isolated checkout C:/dev/dev-sandbox/kb-hook-conflicts-20261015 on codex/hook-repair-conflicts-20261015; original dirty hook worktree remains untouched.
- Merge origin/main at 8e22567b6c168562b3b3ffcd400a3fd1acc4aa39 into PR head d1d130dba78739a21c9b6d35ed6c9197e990037d. Resolve six overlapping files while retaining multipart matching, exact upload IDs/ACTIVE gating, configurable audit path, synthetic-source filtering tests, and intended MCP behavior.
- Adapt upstream polling scenarios to current exact-ID API, retaining partial visibility, custom pack/chunk naming, and slow-inventory wall-clock coverage. No conflict markers remain; schema and security gates unchanged.
- Verified: 120 offline Node regressions passed; ten actual-shell multipart cases passed; twenty production polling assertions passed. Initial complete shell-suite attempt hit 100-second total bound; streamed rerun passed all thirteen cases within 240-second hard bound.
- No live notebook writes, merge to main, force push, or deployment. Next: finish shell suite, commit merge with normal hooks, push HEAD to existing codex/hook-repair-20261015 PR branch, and verify live mergeability/checks.

PR #40 conflict delivery checkpoint:
- Merge commit ff2f6e19babc1afdadf2c32cd60152d111650e7e has parents d1d130db and current main 8e22567b. Normal pre/post-commit hooks passed; offline wiki autoheal completed.
- Normal fast-forward push updated existing codex/hook-repair-20261015 PR branch. Independent ls-remote verifies exact remote head ff2f6e19babc1afdadf2c32cd60152d111650e7e.
- GitHub now reports MERGEABLE; mergeStateStatus UNSTABLE while Full Test Suite, Secret scan, drift-and-publish, and GitGuardian checks run. Devin Review reports SUCCESS. No remote CI pass claimed.
- Completed local validation: 120 offline Node tests, ten mock-only actual-shell multipart cases, twenty polling checks, and thirteen shell-ingestion cases all passed. No live notebook operations or merge to main.
- Retrospective: upstream squash merges produced conflicts despite mostly matching final code; retained behavior-specific coverage while adapting old title-based polling cases to exact returned IDs. Streamed output avoided confusing total runtime bounds with inactivity.
- Preserve hook-generated local wiki/TODO artifacts and this checkpoint; they are outside pushed authored changes. Original dirty hook-repair checkout remains untouched.

PR #40 CI mock repair, 2026-10-15:
- Exact failed remote run 38758117637 at ff2f6e19 aborts three NotebookLM verification journeys because old mocks omit --json help and return prose instead of structured upload receipts. Reproduced locally: three failed, four passed.
- Consolidated those three mock scripts into one test-only structured CLI fixture. Help advertises --json; uploads return unique source_id receipts; inventory reports matching ACTIVE IDs; diagnostics use stderr. Unknown/unstructured upload forms fail visibly.
- All seven integration-verifier journeys now pass, including chunking, rollback, and explicit CLI path containing spaces. Added two actual-shell regressions: unsupported structured output fails before mutation; ambiguous successful upload triggers no second plaintext upload and preserves old sources. Both pass.
- Production upload_pack_file and replace_pack_sources remain unchanged. Proposed heuristic plaintext fallback could duplicate an already successful upload and mistake non-ID output for identity; exact JSON ownership validation remains required.
- Full local test:all first hit unrelated WSL/Windows worktree metadata mismatch in Obsidian test; rerun uses explicit Git Bash PATH with mandatory Bash coverage, 600-second total bound, and 60-second inactivity bound. Evidence: node_modules/.cache/hook-ci-20261015/.
- Full local test:all passed in 120.86 seconds with mandatory Git Bash coverage; no skipped/degraded markers. Dependency/configuration checks passed 3/3. Added multipart safety suite to test:notebooklm so CI exercises all twelve cases.
- Next: commit scoped tests, package script, and status, push existing PR branch, and verify current-head remote suite. No live notebook mutations or security gate bypass.
