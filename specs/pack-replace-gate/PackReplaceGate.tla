---------------------------- MODULE PackReplaceGate ----------------------------
\* Model of scripts/nlm-pack-replace-gate.mjs#replacePackFamilyAtomic
\* for one pack part (willow-run / ford-politics style), two sequential runs.
\* Cluster-sync calls with allowReuse=false, so an EXISTS_ACTIVE copy is
\* uploaded-over then deleted, never reused.
\*
\* Code steps (each action is one await in that function):
\*   ListOk/ListFail     listFn / listNotebookSources
\*   UploadOk/UploadFail uploadFn / nlm source add
\*   PollOk/PollFail     pollFamilyUntilActive
\*   DeleteOldOk/Fail    deleteFn loop, PARTIAL_CUTOVER on fail
\*   RollbackOk/Fail     catch: purge newlyUploadedSourceIds unless PARTIAL_CUTOVER
EXTENDS Naturals, FiniteSets

CONSTANTS MaxRuns, MaxId, DeleteBeforePoll, SkipOrphanRollback

VARIABLES status, nextId, pc, run, oldIds, newIds, outcome

StatusVals == {"absent", "inflight", "active", "error"}
PcVals     == {"list", "upload", "poll", "delete_old", "rollback", "done"}
OutVals    == {"running", "success", "failed", "partial"}

vars == <<status, nextId, pc, run, oldIds, newIds, outcome>>

PackIds    == {i \in 1..MaxId : status[i] # "absent"}
ActiveIds  == {i \in 1..MaxId : status[i] = "active"}
ToDelete   == oldIds \ newIds

TypeOK ==
  /\ status \in [1..MaxId -> StatusVals]
  /\ nextId \in 1..(MaxId + 1)
  /\ pc \in PcVals
  /\ run \in 1..MaxRuns
  /\ oldIds \subseteq 1..MaxId
  /\ newIds \subseteq 1..MaxId
  /\ outcome \in OutVals

Init ==
  /\ status = [i \in 1..MaxId |-> IF i = 1 THEN "active" ELSE "absent"]
  /\ nextId = 2
  /\ pc = "list"
  /\ run = 1
  /\ oldIds = {}
  /\ newIds = {}
  /\ outcome = "running"

\* listFn: collect every live pack-family id as old. Auth fail leaves the notebook.
ListOk ==
  /\ pc = "list"
  /\ oldIds' = PackIds
  /\ pc' = "upload"
  /\ UNCHANGED <<status, nextId, run, newIds, outcome>>

ListFail ==
  /\ pc = "list"
  /\ outcome' = "failed"
  /\ pc' = "done"
  /\ UNCHANGED <<status, nextId, run, oldIds, newIds>>

\* uploadFn: new inflight id, then poll. Bug knob: delete old first.
UploadOk ==
  /\ pc = "upload"
  /\ nextId <= MaxId
  /\ status' = [status EXCEPT ![nextId] = "inflight"]
  /\ newIds' = {nextId}
  /\ nextId' = nextId + 1
  /\ pc' = IF DeleteBeforePoll THEN "delete_old" ELSE "poll"
  /\ UNCHANGED <<oldIds, run, outcome>>

\* NLM_UPLOAD_FAILED / UPLOAD_SOURCE_ID_MISSING: no new id, rollback is a no-op.
UploadFail ==
  /\ pc = "upload"
  /\ newIds' = {}
  /\ pc' = "rollback"
  /\ UNCHANGED <<status, nextId, run, oldIds, outcome>>

\* pollFamilyUntilActive: every new id reaches status 2.
PollOk ==
  /\ pc = "poll"
  /\ newIds # {}
  /\ status' = [i \in 1..MaxId |-> IF i \in newIds THEN "active" ELSE status[i]]
  /\ pc' = "delete_old"
  /\ UNCHANGED <<nextId, run, oldIds, newIds, outcome>>

\* New generation errors (status 3) or times out: catch rolls back orphans.
PollFail ==
  /\ pc = "poll"
  /\ newIds # {}
  /\ status' = [i \in 1..MaxId |-> IF i \in newIds THEN "error" ELSE status[i]]
  /\ pc' = "rollback"
  /\ UNCHANGED <<nextId, run, oldIds, newIds, outcome>>

\* Cutover: purge old ids that are not the new generation.
DeleteOldOk ==
  /\ pc = "delete_old"
  /\ status' = [i \in 1..MaxId |-> IF i \in ToDelete THEN "absent" ELSE status[i]]
  /\ outcome' = "success"
  /\ pc' = "done"
  /\ UNCHANGED <<nextId, run, oldIds, newIds>>

\* PARTIAL_CUTOVER: keep the new ACTIVE copy, leftover old stays, no orphan rollback.
DeleteOldFail ==
  /\ pc = "delete_old"
  /\ ToDelete # {}
  /\ outcome' = "partial"
  /\ pc' = "done"
  /\ UNCHANGED <<status, nextId, run, oldIds, newIds>>

RollbackOk ==
  /\ pc = "rollback"
  /\ status' = IF SkipOrphanRollback
               THEN status
               ELSE [i \in 1..MaxId |-> IF i \in newIds THEN "absent" ELSE status[i]]
  /\ outcome' = "failed"
  /\ pc' = "done"
  /\ UNCHANGED <<nextId, run, oldIds, newIds>>

\* catch: failed to purge orphaned upload — warn only (current code).
RollbackFail ==
  /\ pc = "rollback"
  /\ newIds # {}
  /\ ~SkipOrphanRollback
  /\ outcome' = "failed"
  /\ pc' = "done"
  /\ UNCHANGED <<status, nextId, run, oldIds, newIds>>

\* Next sweep: leftover copies are listed as old and deleted if this run succeeds.
StartNextRun ==
  /\ pc = "done"
  /\ run < MaxRuns
  /\ run' = run + 1
  /\ pc' = "list"
  /\ oldIds' = {}
  /\ newIds' = {}
  /\ outcome' = "running"
  /\ UNCHANGED <<status, nextId>>

Term ==
  /\ pc = "done"
  /\ run = MaxRuns
  /\ UNCHANGED vars

Next ==
  \/ ListOk
  \/ ListFail
  \/ UploadOk
  \/ UploadFail
  \/ PollOk
  \/ PollFail
  \/ DeleteOldOk
  \/ DeleteOldFail
  \/ RollbackOk
  \/ RollbackFail
  \/ StartNextRun
  \/ Term

Spec == Init /\ [][Next]_vars

\* Harm: a notebook that started with a pack must keep at least one copy.
NotebookNeverEmpty == PackIds # {}

\* A successful cutover leaves exactly one ACTIVE pack.
SuccessImpliesOneActive ==
  outcome = "success" => (PackIds = ActiveIds /\ Cardinality(PackIds) = 1)

\* Stage-all-before-drop-any: delete_old is not reachable until new ids are ACTIVE.
NoDeleteUntilNewActive ==
  pc = "delete_old" => \A i \in newIds : status[i] = "active"

\* When a run has finished, at most one copy. Current code breaks this
\* on PARTIAL_CUTOVER and on failed orphan rollback. Do not weaken it.
SettledAtMostOne ==
  pc = "done" => Cardinality(PackIds) <= 1
=============================================================================
