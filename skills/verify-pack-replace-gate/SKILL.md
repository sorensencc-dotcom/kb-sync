---
name: verify-pack-replace-gate
description: >
  Use when changing replacePackFamilyAtomic, pollFamilyUntilActive,
  probeExistingPackSource, deleteNotebookSource, cluster-sync pack dispatch,
  or any pack cutover / EXISTS_ACTIVE / PARTIAL_CUTOVER / empty-notebook /
  duplicate pack-source behavior.
---

# Verify pack replace-gate cutover

A notebook that already has a pack must never go empty during replace. A successful run leaves exactly one ACTIVE copy. Cluster-sync does not set `allowReuse`, so an EXISTS_ACTIVE title is a prior generation: upload a new copy, wait until it is ACTIVE, then delete the old id.

## Does this change touch it?

Yes if the diff includes `scripts/nlm-pack-replace-gate.mjs`, `scripts/notebooklm/replace-pack-family-cli.mjs`, or the pack-dispatch block in `scripts/pipeline/cluster-sync-runner.mjs`.

## Run

From `C:\dev\kb-sync`:

```powershell
node specs/pack-replace-gate/run-tlc.mjs
node --test tests/nlm-pack-replace-gate.test.mjs
```

TLC uses `C:\Users\soren\.tla\jdk\bin\java.exe` and `C:\Users\soren\.tla\tla2tools.jar` (tlaplus v1.7.4). Override with `JAVA` and `TLA2TOOLS`.

A pass is: `run-tlc.mjs` exit 0 **and** the test file green. `run-tlc.mjs` already expects two TLC failures:

| Check | Meaning in the code |
|---|---|
| PASS current cutover | Old pack is still there until the new copy is ACTIVE; success means one ACTIVE copy. |
| FINDING SettledAtMostOne | A **finished** failed run can leave two copies: `PARTIAL_CUTOVER` (new ACTIVE, old leftover) or orphan rollback delete failed. Next successful run lists both as old and deletes them. Do not weaken this. |
| FINDING delete-before-poll | `DeleteBeforePoll=TRUE` reaches `delete_old` while the new copy is still inflight. That is the empty-notebook bug. |

A **new** invariant name, a pass on SettledAtMostOne, or a fail of `NotebookNeverEmpty` / `SuccessImpliesOneActive` / `NoDeleteUntilNewActive` on the current-code cfg is a real bug or a stale model. Replay the TLC action names against the function (`ListOk` = `listFn`, `UploadOk` = `uploadFn`, `PollOk` = `pollFamilyUntilActive`, `DeleteOld*` = the cutover loop, `Rollback*` = the `catch` orphan purge). If the code does that step, keep the finding. If the code cannot, fix the spec.

## Bounds

One pack part, two runs, at most four source ids. No multipart families, no `allowReuse: true`, no live `nlm` auth. A pass is the model at this bound, not NotebookLM itself.

## Coverage (sync `5b950e0f`)

| Code | Model |
|---|---|
| `replacePackFamilyAtomic` list + probe + upload loop | `ListOk` / `ListFail` / `UploadOk` / `UploadFail` |
| `pollFamilyUntilActive` then cutover delete | `PollOk` / `PollFail` / `DeleteOldOk` / `DeleteOldFail` |
| `catch` orphan purge unless `PARTIAL_CUTOVER:` | `RollbackOk` / `RollbackFail` |
| cluster-sync `allowReuse` omitted (false) | no reuse action |

Move this sync commit forward only after TLC still describes those steps at the new HEAD. Uncommitted EXISTS_ACTIVE log wording does not change the order.

After an intended cutover change, edit `specs/pack-replace-gate/PackReplaceGate.tla` first, rerun `run-tlc.mjs`, then the tests. Product code only if the user asks. `/maintain-formal-verification-skill` if HEAD moved without a recheck.
