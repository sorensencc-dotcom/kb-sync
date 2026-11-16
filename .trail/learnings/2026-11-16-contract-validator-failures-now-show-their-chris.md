---
title: "Contract validator failures now show their output, and a Windows temp-cleanup EPERM in test 7 is unverified"
author: Chris
date: 2026-11-16
branch: fix/pipeline-contract-diagnostics
id: l-cd9015e6
scope: repo
status: active
src: agent
touches:
  - modules/wiki/pipeline-runner.ts
  - tests/pipeline-freshness.test.ts
---

## Decided
Failed contract validation keeps the validator's stdout, stderr and spawn error in the pipeline log. The Windows EPERM during test 7 is treated as an environment flake, not part of this change, until it reproduces on the pre-change tree.

In the code: defaultValidateContract in modules/wiki/pipeline-runner.ts; test 'pipeline contract failures persist validator stdout and stderr' in tests/pipeline-freshness.test.ts.

## Tried and ruled out
The first failure read 'exited 1' with no diagnostic. That run predated the patch, so it was not evidence about the new code. Rerunning test 7 alone passed; the full suite failed only there, with EPERM removing .wiki-publish-temp under TEMP.

In the code: publishWiki and removeDirRobust in scripts/sync-github-wiki.mjs, called from test 7.

## Watch out
Edit and Write turned CRLF files into LF and made whole-file diffs. Check diff stat with --ignore-cr-at-eol before committing. A git checkout also starts the KB-Sync autoheal hook in the background, so wait for it before staging. Confirm test 7 against 4f68ded2 before calling the EPERM pre-existing.
