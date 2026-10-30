# TrmIngestDrive

TLC reached 8 states and 10 steps. The chart draws 8 states and 10 arrows.

## Invariants Formally Proven
- **TypeOK**: Variables conform to typed domains.
- **LockOnlyHeldDuringWrite**: `hasLock` is strictly false whenever in `BUFFERED`, `COMPLETED`, or `REJECTED`.
- **NoCorruptIngest**: State can only transition to `INGESTING` if `isValid = TRUE`, `isDuplicate = FALSE`, and `hasLock = TRUE`.
