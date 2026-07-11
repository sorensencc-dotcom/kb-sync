# register-kb-sync-task.ps1

**Type:** Script  
**Location:** `scripts/register-kb-sync-task.ps1`  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Summary

Windows Task Scheduler registration script that automates setup of scheduled kb-sync runs on Windows systems.

Registers a Windows scheduled task to run `npm run kb:sync` nightly, eliminating manual cron configuration on Windows. Requires administrator privileges to execute.

---

## Attributes

### Input
- PowerShell execution context (must run as Administrator)
- Script parameters: task name, schedule (default: 00:00 UTC daily)
- Repository context: must be run from repo root

### Output
- Windows scheduled task registered in Task Scheduler
- Exit code: 0 (success), 1 (permission error, task exists, etc.)

### Side Effects
- Creates or updates a Windows scheduled task
- Scheduled task will execute `npm run kb:sync` at specified times
- Requires administrator privileges (runs as SYSTEM or specified user)

### Performance Characteristics
- Setup time: ~1–2 seconds
- No ongoing performance impact (task runs infrequently, typically nightly)

### Constraints & Limits
- Windows only (PowerShell cmdlet for Task Scheduler)
- Requires administrator privileges to register task
- Cannot register task if scheduled task with same name already exists (unless overwrite flag is used)
- Task execution requires npm and all kb-sync dependencies to be available in scheduled context

---

## Relationships

### Called By
- Administrator via `powershell -ExecutionPolicy Bypass -File register-kb-sync-task.ps1`
- Setup/onboarding scripts

### Calls / Depends On
- Windows Task Scheduler API (PowerShell `Register-ScheduledTask`)
- npm environment

### Related Concepts
- [[Deterministic Sync Pipeline]]

### Participates In Workflows
- Windows-specific setup workflows
- CI/CD integration

---

## Cross-References

### Bidirectional Links

- Related entities: [[kb-sync-nightly.sh]]
- Related concepts: [[Deterministic Sync Pipeline]]
- Backlinks from: [[notebooklm module]]

---

## Source Citations

**Primary Source:** `scripts/register-kb-sync-task.ps1`  
**Related:** Windows Task Scheduler API  
**Pack Reference:** `--- START FILE: scripts/register-kb-sync-task.ps1 ---` to `--- END FILE: scripts/register-kb-sync-task.ps1 ---`

---

## Implementation Notes

The script uses `Register-ScheduledTask` to register the task. On Windows systems without `Register-ScheduledTask` availability (older PowerShell versions), fallback to `schtasks.exe` command-line tool can be implemented.

The script should verify npm is in `$env:PATH` before registering, to catch configuration issues at setup time rather than task execution time.

Administrator elevation should be checked at script entry; if not elevated, the script should exit with a clear error message.
