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

Delivery: Scoped commit and branch push pending final hooks and remote verification. No merge, deployment, production notebook execution, or fixture changes.

Not checked: full unrelated kb-sync suite or remote CI. Raw live receipts remain ignored local artifacts; commits contain code, tests, configuration, and this status only.
