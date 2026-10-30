------------------------ MODULE TrmIngestDrive ------------------------
EXTENDS Naturals

VARIABLES state, hasLock, isDuplicate, isValid

vars == <<state, hasLock, isDuplicate, isValid>>

States == {
  "BUFFERED",
  "DEBOUNCING",
  "VALIDATING",
  "INGESTING",
  "ARCHIVING",
  "REJECTED",
  "SKIPPED_DUPLICATE",
  "COMPLETED"
}

Init ==
  /\ state = "BUFFERED"
  /\ hasLock = FALSE
  /\ isDuplicate = FALSE
  /\ isValid = TRUE

FileArrives ==
  /\ state = "BUFFERED"
  /\ state' = "DEBOUNCING"
  /\ UNCHANGED <<hasLock, isDuplicate, isValid>>

DebounceSettles ==
  /\ state = "DEBOUNCING"
  /\ state' = "VALIDATING"
  /\ UNCHANGED <<hasLock, isDuplicate, isValid>>

ValidationFails ==
  /\ state = "VALIDATING"
  /\ state' = "REJECTED"
  /\ isValid' = FALSE
  /\ UNCHANGED <<hasLock, isDuplicate>>

DuplicateDetected ==
  /\ state = "VALIDATING"
  /\ isValid = TRUE
  /\ state' = "SKIPPED_DUPLICATE"
  /\ isDuplicate' = TRUE
  /\ UNCHANGED <<hasLock, isValid>>

ValidNewFinding ==
  /\ state = "VALIDATING"
  /\ isValid = TRUE
  /\ isDuplicate = FALSE
  /\ state' = "INGESTING"
  /\ hasLock' = TRUE
  /\ UNCHANGED <<isDuplicate, isValid>>

AppendEvidenceAndArchive ==
  /\ state = "INGESTING"
  /\ state' = "ARCHIVING"
  /\ UNCHANGED <<hasLock, isDuplicate, isValid>>

ReleaseLockAndComplete ==
  /\ state = "ARCHIVING"
  /\ state' = "COMPLETED"
  /\ hasLock' = FALSE
  /\ UNCHANGED <<isDuplicate, isValid>>

HandleRejected ==
  /\ state = "REJECTED"
  /\ state' = "BUFFERED"
  /\ isValid' = TRUE
  /\ UNCHANGED <<hasLock, isDuplicate>>

HandleSkippedDuplicate ==
  /\ state = "SKIPPED_DUPLICATE"
  /\ state' = "BUFFERED"
  /\ isDuplicate' = FALSE
  /\ UNCHANGED <<hasLock, isValid>>

ResetToBuffer ==
  /\ state = "COMPLETED"
  /\ state' = "BUFFERED"
  /\ UNCHANGED <<hasLock, isDuplicate, isValid>>

Next ==
  \/ FileArrives
  \/ DebounceSettles
  \/ ValidationFails
  \/ DuplicateDetected
  \/ ValidNewFinding
  \/ AppendEvidenceAndArchive
  \/ ReleaseLockAndComplete
  \/ HandleRejected
  \/ HandleSkippedDuplicate
  \/ ResetToBuffer

Spec == Init /\ [][Next]_vars

(* Safety & Invariant Properties *)
TypeOK ==
  /\ state \in States
  /\ hasLock \in {TRUE, FALSE}
  /\ isDuplicate \in {TRUE, FALSE}
  /\ isValid \in {TRUE, FALSE}

LockOnlyHeldDuringWrite ==
  (state \in {"BUFFERED", "COMPLETED", "REJECTED"}) => (hasLock = FALSE)

NoCorruptIngest ==
  (state = "INGESTING") => (isValid = TRUE /\ isDuplicate = FALSE /\ hasLock = TRUE)
=============================================================================
