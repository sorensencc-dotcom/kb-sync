---
title: A pack cutover that fails to delete an old copy leaves a duplicate that the next good run removes
author: Chris
date: 2026-11-07
branch: chore/issue-121-bombard-williamson-redaction-index
id: l-17be23a7
scope: repo
status: active
src: agent
touches:
  - "scripts/nlm-pack-replace-gate.mjs#deleteNotebookSource"
  - "scripts/nlm-pack-replace-gate.mjs#replacePackFamilyAtomic"
  - scripts/notebooklm/replace-pack-family-cli.mjs
---

## Decided
- A NotebookLM "No such command 'remove'" error during research sync is not the real failure. The delete helper tries `source delete` twice, then `source remove`, and reports only the last error. nlm 0.15.6 has no `remove`, so the real delete error is always hidden.
- When one old copy fails to delete, the run throws PARTIAL_CUTOVER, keeps the new ACTIVE copy, marks the notebook FAILED and quarantined, and the sweep continues. Next run lists every copy with the same pack name as old, so a good run deletes the leftover duplicate. A TLA+ model (one part, two runs, 47 states) confirmed: notebook never goes empty, "success" always means one copy, but a failed run can end with two copies (delete failure, or a failed rollback of an orphan upload).

## Tried and ruled out
- Treating the scheduled task as failed: LastTaskResult 267009 is 0x41301 SCHED_S_TASK_RUNNING; the run was still going.

## Watch out
- Fix the fallback list to drop `remove` and surface the first attempt's error before trying to diagnose a delete failure.
- 2026-11-06 run left two `pack_master_kb_part21.txt` sources in master-kb (old id b794f755…). A manual `nlm source delete <id> -y` succeeded minutes later, so the failure was transient; the fix now retries 3 rounds 2s apart and reports every attempt.

In the code:
- scripts/nlm-pack-replace-gate.mjs deleteNotebookSource L229-252 (fallback list), replacePackFamilyAtomic L655-662 (old-set from all family matches), L754-772 (PARTIAL_CUTOVER), L787-795 (rollback delete failure only warns).
- scripts/notebooklm/replace-pack-family-cli.mjs L70-91 has the same fallback list.
- scripts/pipeline/cluster-sync-runner.mjs runNotebookSweep L387-393 records quarantine and continues.
