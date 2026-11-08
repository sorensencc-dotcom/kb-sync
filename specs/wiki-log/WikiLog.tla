---- MODULE WikiLog ----
\* Live wiki Log.md is append-only (modules/wiki/schema.md).
\* Code: modules/obsidian/synthesize-wiki.ts
\*   validateProposalSchema rejects vaultPath Log.md
\*   copyWikiToTransact copies live wiki, then writeFileSync accepted proposals
\*   seed transact Log.md only if missing
\*   copyTransactToWiki skips existing live Log.md
\*   appendFileSync adds the session stanza
\*
\* Bug knobs (FALSE = current code after 05e70916):
\*   AllowLogProposal     — old isRootSpecial treated Log.md like Index.md
\*   PromoteExistingLog   — old copyTransactToWiki replaced live Log.md
EXTENDS Naturals

CONSTANTS AllowLogProposal, PromoteExistingLog

VARIABLES phase, chose, liveLog, transactLog
vars == <<phase, chose, liveLog, transactLog>>

TypeOK ==
    /\ phase \in {"idle", "proposed", "tx_ready", "done"}
    /\ chose \in {"page", "log", "index"}
    /\ liveLog \in {"empty", "history", "wiped"}
    /\ transactLog \in {"absent", "history", "seeded", "wiped"}

Init ==
    /\ phase = "idle"
    /\ chose = "page"
    /\ liveLog \in {"empty", "history"}
    /\ transactLog = "absent"

\* Provider returns one vaultPath.
YouRunSynthesize ==
    /\ phase = "idle"
    /\ phase' = "proposed"
    /\ chose' \in {"page", "log", "index"}
    /\ UNCHANGED <<liveLog, transactLog>>

\* copyWikiToTransact, then writeFileSync of accepted proposals, then seed if missing.
\* Current code: Log.md is never accepted, so a log choice leaves the copied live log.
CopyAndWrite ==
    /\ phase = "proposed"
    /\ phase' = "tx_ready"
    /\ transactLog' =
         IF chose = "log" /\ AllowLogProposal
         THEN "wiped"
         ELSE IF liveLog = "history" THEN "history"
         ELSE "seeded"
    /\ UNCHANGED <<liveLog, chose>>

\* copyTransactToWiki then appendFileSync. Skip live Log.md when it already exists.
Promote ==
    /\ phase = "tx_ready"
    /\ phase' = "done"
    /\ liveLog' =
         IF liveLog = "history" /\ ~PromoteExistingLog
         THEN "history"
         ELSE IF transactLog = "wiped" THEN "wiped"
         ELSE "history"
    /\ UNCHANGED <<transactLog, chose>>

Done ==
    /\ phase = "done"
    /\ UNCHANGED vars

Next == YouRunSynthesize \/ CopyAndWrite \/ Promote \/ Done

Spec == Init /\ [][Next]_vars

\* Prior entries stay. Empty first-run may seed a header. Never replace with a proposal body.
LogHistoryKept == liveLog # "wiped"
====
