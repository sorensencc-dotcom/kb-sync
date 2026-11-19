------------------------ MODULE TrmIngestDrive ------------------------
EXTENDS Naturals

VARIABLES state, hasLock, isDuplicate, isValid, isNormalized, isHealed

vars == <<state, hasLock, isDuplicate, isValid, isNormalized, isHealed>>

States == {
  "BUFFERED",
  "DEBOUNCING",
  "NORMALIZING",
  "VALIDATING",
  "INGESTING",
  "ARCHIVING",
  "REJECTED",
  "HEALED_AND_STAGED",
  "SKIPPED_DUPLICATE",
  "COMPLETED"
}

Init ==
  /\ state = "BUFFERED"
  /\ hasLock = FALSE
  /\ isDuplicate = FALSE
  /\ isValid = TRUE
  /\ isNormalized = FALSE
  /\ isHealed = FALSE

FileArrives ==
  /\ state = "BUFFERED"
  /\ state' = "DEBOUNCING"
  /\ UNCHANGED <<hasLock, isDuplicate, isValid, isNormalized, isHealed>>

DebounceSettles ==
  /\ state = "DEBOUNCING"
  /\ state' = "NORMALIZING"
  /\ UNCHANGED <<hasLock, isDuplicate, isValid, isNormalized, isHealed>>

NormalizePayload ==
  /\ state = "NORMALIZING"
  /\ state' = "VALIDATING"
  /\ isNormalized' = TRUE
  /\ UNCHANGED <<hasLock, isDuplicate, isValid, isHealed>>

ValidationFails ==
  /\ state = "VALIDATING"
  /\ isHealed = FALSE
  /\ state' = "REJECTED"
  /\ isValid' = FALSE
  /\ UNCHANGED <<hasLock, isDuplicate, isNormalized, isHealed>>

DuplicateDetected ==
  /\ state = "VALIDATING"
  /\ isValid = TRUE
  /\ state' = "SKIPPED_DUPLICATE"
  /\ isDuplicate' = TRUE
  /\ UNCHANGED <<hasLock, isValid, isNormalized, isHealed>>

ValidNewFinding ==
  /\ state = "VALIDATING"
  /\ isValid = TRUE
  /\ isDuplicate = FALSE
  /\ state' = "INGESTING"
  /\ hasLock' = TRUE
  /\ UNCHANGED <<isDuplicate, isValid, isNormalized, isHealed>>

HealAndStage ==
  /\ state = "REJECTED"
  /\ state' = "HEALED_AND_STAGED"
  /\ isHealed' = TRUE
  /\ isValid' = TRUE
  /\ UNCHANGED <<hasLock, isDuplicate, isNormalized>>

ReingestHealedCard ==
  /\ state = "HEALED_AND_STAGED"
  /\ state' = "VALIDATING"
  /\ UNCHANGED <<hasLock, isDuplicate, isValid, isNormalized, isHealed>>

AppendEvidenceAndArchive ==
  /\ state = "INGESTING"
  /\ state' = "ARCHIVING"
  /\ UNCHANGED <<hasLock, isDuplicate, isValid, isNormalized, isHealed>>

ReleaseLockAndComplete ==
  /\ state = "ARCHIVING"
  /\ state' = "COMPLETED"
  /\ hasLock' = FALSE
  /\ UNCHANGED <<isDuplicate, isValid, isNormalized, isHealed>>

HandleRejected ==
  /\ state = "REJECTED"
  /\ state' = "BUFFERED"
  /\ isValid' = TRUE
  /\ isNormalized' = FALSE
  /\ isHealed' = FALSE
  /\ UNCHANGED <<hasLock, isDuplicate>>

HandleSkippedDuplicate ==
  /\ state = "SKIPPED_DUPLICATE"
  /\ state' = "BUFFERED"
  /\ isDuplicate' = FALSE
  /\ isNormalized' = FALSE
  /\ isHealed' = FALSE
  /\ UNCHANGED <<hasLock, isValid>>

ResetToBuffer ==
  /\ state = "COMPLETED"
  /\ state' = "BUFFERED"
  /\ isNormalized' = FALSE
  /\ isHealed' = FALSE
  /\ UNCHANGED <<hasLock, isDuplicate, isValid>>

Next ==
  \/ FileArrives
  \/ DebounceSettles
  \/ NormalizePayload
  \/ ValidationFails
  \/ DuplicateDetected
  \/ ValidNewFinding
  \/ HealAndStage
  \/ ReingestHealedCard
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
  /\ isNormalized \in {TRUE, FALSE}
  /\ isHealed \in {TRUE, FALSE}

LockOnlyHeldDuringWrite ==
  (state \in {"BUFFERED", "COMPLETED", "REJECTED", "HEALED_AND_STAGED"}) => (hasLock = FALSE)

NoCorruptIngest ==
  (state = "INGESTING") => (isValid = TRUE /\ isDuplicate = FALSE /\ hasLock = TRUE)

NoSpuriousQuarantine ==
  (state = "REJECTED") => (isValid = FALSE /\ isHealed = FALSE)

NormalizesBeforeValidation ==
  (state = "VALIDATING") => (isNormalized = TRUE)

=============================================================================
