---
title: "WikiEntitiesTestWatchlistRunMjs"
category: "wiki"
status: "active"
citations: ["kb-sync/test-watchlist-run.mjs"]
sourceRepository: kb-sync
---

# WikiEntitiesTestWatchlistRunMjs

## Summary
Integration test suite for validating competitor watchlist monitoring, SQLite connector schema foreign key validation, drift detection, and signed approval persistence.

## Assertions
1. Validates pre-seeding of `connector_profiles` (`prof_writer_001`).
2. Evaluates drift on simulated `google/sam` repository payload.
3. Asserts persistence into `local_approvals` with pending status, capability `sigil.core/read_shared_context`, and 64-character SHA-256 action hash.

## Source Citations
- Staged: `kb-sync/test-watchlist-run.mjs`
