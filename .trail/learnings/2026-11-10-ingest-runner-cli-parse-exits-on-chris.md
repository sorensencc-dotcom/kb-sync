---
title: Ingest runner CLI parse exits on import
author: Chris
date: 2026-11-10
branch: main
id: l-2211c926
scope: repo
status: active
src: agent
touches:
  - ".sync-status.json"
  - TODOS.md
  - "_status-feed/chat_injection_audit.json"
  - core/harvest_registry.json
  - modules/compactor/index.mjs
  - modules/trm/storage/transaction-manager.mjs
  - obsidian/vault/wiki/Index.md
  - obsidian/vault/wiki/Log.md
  - obsidian/vault/wiki/kb-sync/wiki/.Catalog.md
  - obsidian/vault/wiki/kb-sync/wiki/.CoverageReport.md
---

## Decided
- ingest-nlm-runner argument parse and process.exit(3) on missing notebook UUID run at module load. Wrapping only main() still kills importers of acquireIngestLock. Gate that UUID exit with the same invokedDirectly check, and give stagingDir a dummy segment when uuid is absent.

## Tried and ruled out
- CLI guard around main() only: a worker that imports the module still exits 3 with MISSING_NOTEBOOK_UUID, then crashes on path.resolve(..., undefined) for stagingDir.

## Watch out
- generate-kb-sync-artifact.mjs is copied alone by tests/notebooklm-telemetry-contract.test.mjs, so it cannot import updateJsonLocked. SUCCESS-over-FAILED stays inline there.
