---
title: "Contract validator output stays, and the temp cleanup error did not reproduce"
author: Chris
date: 2026-11-16
branch: fix/pipeline-contract-diagnostics
id: l-e22efd32
scope: repo
status: active
replaces: l-cd9015e6
src: agent
touches:
  - modules/wiki/pipeline-runner.ts
  - tests/pipeline-freshness.test.ts
  - scripts/sync-github-wiki.mjs
---

## Decided
- A failed contract check keeps the validator stdout, stderr, and spawn error. A bare `exited 1` cannot separate a validator failure from a spawn failure, which is what made the November 13 staging failure undiagnosable.
- Do not treat an EPERM from test 7 as pre-existing, or as caused by that diagnostics change, unless the same full file fails on the parent commit. The full file exited 0 on `4f68ded2` and on this branch.

## Tried and ruled out
- Diagnosing the staging failure from `exited 1` with no validator output.
- Blaming `defaultValidateContract` for the EPERM. Test 7 deletes the publish scratch directory through `publishWiki`. The diagnostics change does not touch that removal.

## Watch out
- An EPERM in test 7 comes from removing `.wiki-publish-temp`, so chase `publishWiki` before changing the contract-validator detail.
- The sibling hook measures the legacy basename page. Refreshing the hash-named inventory page leaves that basename redirect's bytes, and its mtime warning, unchanged.

In the code: `defaultValidateContract` in `modules/wiki/pipeline-runner.ts`; test 7 and `pipeline contract failures persist validator stdout and stderr` in `tests/pipeline-freshness.test.ts`; `publishWiki` in `scripts/sync-github-wiki.mjs`.
