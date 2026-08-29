---
title: "WikiEntitiesVerifyDependenciesMjs"
category: "wiki"
status: "active"
citations: ["scripts/verify-dependencies.mjs"]
sourceRepository: kb-sync
---

# WikiEntitiesVerifyDependenciesMjs

## Summary
Deterministic dependency guard for the KB-Sync toolchain. It verifies that required manifest dependencies remain pinned to the versions expected by the repository.

## Usage
Run `npm run deps:verify` from the repository root. A mismatch exits non-zero and blocks dependent release or validation workflows.

## Source Citations
- Source: `scripts/verify-dependencies.mjs`
