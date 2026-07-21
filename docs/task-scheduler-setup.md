---
title: "task scheduler setup"
category: "wiki"
status: "active"
---

# Windows Task Scheduler Setup for KB-Sync

**Purpose**: Schedule kb-sync pipeline stages as native Windows tasks to avoid bash environment constraints and improve reliability.

**Status**: Implementation-ready  
**Maintainer**: Chris (Architect — Tier 1)

---

## Why Task Scheduler?

### Problems with Bash Environment

1. **Timeouts**: Bash calls in constrained environment timeout after 30-45 seconds
2. **No network**: Cannot push to GitHub or fetch remote resources
3. **Permission issues**: Cannot modify `.git/index.lock` or other system files
4. **Non-interactive**: Cannot handle authentication flows

### Task Scheduler Solution

1. **Native execution**: PowerShell runs directly on Windows with full permissions
2. **Scheduled reliability**: Tasks retry on failure, log output, support dependencies
3. **No timeouts**: Each task runs to completion
4. **Data consolidation**: Pipeline runs on fixed schedule; no manual triggering

---

## Task Pipeline Architecture

```
┌─────────────────────────────────────────┐
│  00:30 — Stage Raw Sources             │  npm run kb:sync:obsidian
│  (Create timestamped staging dir)      │  └─ Immutable, audit trail
└─────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│  00:35 — Validate Staging (5 min)       │  npm run wiki:validate-staging
│  (Check manifest, file count)           │  └─ Fail-fast on errors
└─────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│  00:40 — Generate Ingest Prompt         │  npm run wiki:ingest:obsidian:prompt
│  (Ready for Claude synthesis)           │  └─ Output to logs
└─────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│  01:00 — Generate Knowledge Pack        │  npm run kb:sync:notebooklm
│  (Consolidate sources, optional)        │  └─ For backup/alternative ingest
└─────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│  02:00 — Cleanup Archives               │  npm run wiki:cleanup-archives
│  (Retention policy enforcement)         │  └─ Delete old stagings per policy
└─────────────────────────────────────────┘
```

**Total Duration**: ~90 minutes (5 min staging → 10 min validation → 20 min pack generation → 55 min cleanup)

**Overlap Prevention**: Task Scheduler's `IgnoreNew` setting prevents concurrent runs.

---

## Installation

### Prerequisites

- Windows 10+ or Server 2016+
- PowerShell 5.0+
- **Administrator privileges** (required for Task Scheduler)
- Node.js + npm (already installed)

### Install All Tasks

```powershell
# Run as Administrator
cd C:\dev\kb-sync
.\scripts\setup-scheduled-tasks.ps1
```

**Output**:
```
Installing KB-Sync scheduled tasks...
Repo: C:\dev\kb-sync
User: DOMAIN\username

✓ Registered: KB-Sync-Stage-Sources (Daily @ 00:30)
✓ Registered: KB-Sync-Validate-Staging (Daily @ 00:35)
✓ Registered: KB-Sync-Generate-Prompt (Daily @ 00:40)
✓ Registered: KB-Sync-Consolidate-Pack (Daily @ 01:00)
✓ Registered: KB-Sync-Cleanup-Archives (Daily @ 02:00)

✓ All tasks installed successfully!
View logs: C:\dev\kb-sync\logs\
```

### Verify Installation

```powershell
# List installed tasks
.\scripts\setup-scheduled-tasks.ps1 -List

# Output:
# === KB-Sync Scheduled Tasks ===
#
# ✓ KB-Sync-Stage-Sources
#   Schedule: 00:30 UTC
#   Description: Stage raw sources for Obsidian wiki ingest
#   Status: Ready
#   Next Run: 2026-07-21 00:30:00
```

### Uninstall Tasks

```powershell
# Remove all KB-Sync tasks
.\scripts\setup-scheduled-tasks.ps1 -Uninstall
```

---

## Task Details

### 1. KB-Sync-Stage-Sources (00:30 UTC)

**Command**: `npm run kb:sync:obsidian`

**What it does**:
- Calls `core/flatten.sh --manifest` to generate file list
- Copies all repo files to `_kb-sync-staging/kb-sync/<TIMESTAMP>/`
- Generates immutable manifest (`FILES.manifest.txt`)
- Preserves full directory structure

**Expected output**: Staging directory created, 170+ files copied

**Failure handling**:
- If vault_root not set: Exits cleanly (fail-soft), logs warning
- If staging fails: Logged to `logs/KB-Sync-Stage-Sources-*.log`

**Duration**: 30–60 seconds

---

### 2. KB-Sync-Validate-Staging (00:35 UTC)

**Command**: `npm run wiki:validate-staging`

**What it does**:
- Verifies staging directory exists
- Checks manifest file is present
- Counts files (should match manifest)
- Validates no corruption

**Expected output**: "Staging valid: 170 files"

**Failure handling**:
- If validation fails: Raises error, prevents downstream tasks
- Logs full report to `logs/KB-Sync-Validate-Staging-*.log`

**Duration**: 10–20 seconds

---

### 3. KB-Sync-Generate-Prompt (00:40 UTC)

**Command**: `npm run wiki:ingest:obsidian:prompt`

**What it does**:
- Reads staging manifest
- Generates structured Claude Code ingest prompt
- Outputs to `logs/KB-Sync-Generate-Prompt-*.log`

**Expected output**: Ready-to-paste prompt for Claude Code session

**Failure handling**:
- Logs any errors (usually config issues)
- Continues even if this task fails (non-blocking)

**Duration**: 5–10 seconds

**Note**: This task's output is informational. Actual wiki synthesis happens in Claude Code (Phases 1–6) or via obsidian-ingest-wiki skill.

---

### 4. KB-Sync-Consolidate-Pack (01:00 UTC)

**Command**: `npm run kb:sync:notebooklm`

**What it does**:
- Generates knowledge pack at `.nlm_pack/repo_knowledge_pack.txt`
- Applies skip patterns and extension filters
- Concatenates all included files with delimiters

**Expected output**: Knowledge pack 5–10 MB

**Failure handling**:
- If pack exceeds size limit: Triggers chunking via `core/chunk.sh`
- Logs all details to `logs/KB-Sync-Consolidate-Pack-*.log`

**Duration**: 30–60 seconds

**Note**: This is a secondary data source. Primary ingest is via staging + Obsidian wiki.

---

### 5. KB-Sync-Cleanup-Archives (02:00 UTC)

**Command**: `npm run wiki:cleanup-archives`

**What it does**:
- Scans `_kb-sync-staging/` for old directories
- Applies retention policy (default: keep last 10)
- Archives or deletes older stagings

**Expected output**: "Cleaned up 2 old stagings (retained 10)"

**Failure handling**:
- If cleanup fails: Logged but non-blocking (staging still works)
- Dry-run mode available: `npm run wiki:cleanup-archives:dry-run`

**Duration**: 10–30 seconds

---

## Monitoring & Logs

### Log Location

```
C:\dev\kb-sync\logs\
  KB-Sync-Stage-Sources-20260721-003001.log
  KB-Sync-Validate-Staging-20260721-003502.log
  KB-Sync-Generate-Prompt-20260721-004001.log
  KB-Sync-Consolidate-Pack-20260721-010001.log
  KB-Sync-Cleanup-Archives-20260721-020001.log
```

### Viewing Logs

```powershell
# View latest stage run
Get-Content C:\dev\kb-sync\logs\KB-Sync-Stage-Sources-*.log -Tail 50

# Monitor all tasks (live)
Get-ScheduledTask -TaskName "KB-Sync-*" | Select-Object TaskName, State, @{Name='LastResult';Expression={$_.Triggers[0]}}
```

### Email Alerts (Optional)

Task Scheduler can be configured to email on failure (requires SMTP setup):

```powershell
# Edit task to add email action on failure
$Task = Get-ScheduledTask -TaskName "KB-Sync-Stage-Sources"
$Task.Actions[0].Arguments  # View current action
```

---

## Troubleshooting

### Task Won't Run (Status: Disabled)

```powershell
# Re-enable task
Enable-ScheduledTask -TaskName "KB-Sync-Stage-Sources"
```

### Task Runs But Exits with Error

1. Check logs: `C:\dev\kb-sync\logs\`
2. Verify npm commands work manually: `npm run kb:sync:obsidian`
3. Check Node.js path in PATH environment variable

### Tasks Running Sequentially (Overlap)

Task Scheduler is designed for this. If one task is slow, next one waits.

To force parallelization (not recommended):
- Adjust start times in setup script
- Accept risk of race conditions

---

## Customization

### Change Schedule Time

```powershell
# Edit setup script to change start time
$ScheduleTime = "01:30"  # Start at 1:30 AM instead of 00:30 AM
.\scripts\setup-scheduled-tasks.ps1
```

### Add New Task

```powershell
# Add to $Tasks array in setup script
@{
    Name        = "KB-Sync-Custom-Task"
    Description = "My custom kb-sync task"
    Schedule    = "03:00"
    Script      = "npm run my-custom-script"
    WorkDir     = $RepoRoot
    Priority    = "Normal"
    RunLevel    = "Limited"
}
```

### Disable Cleanup (Keep All Stagings)

```powershell
# Comment out the Cleanup task in setup script
# Or edit retention policy in configs/global.yaml
```

---

## Integration with Obsidian Wiki Synthesis

**Current Workflow (Manual)**:
1. Run `npm run kb:sync:obsidian` manually
2. Open Claude Code, read staged sources
3. Run 8-phase synthesis workflow
4. Commit changes

**Future Workflow (Scheduled)**:
1. **00:30** — Task Scheduler runs staging automatically
2. **00:40** — Prompt generated and logged
3. **[Human]** — Open logged prompt in Claude Code; run phases 1–6 (or full 8-phase if using skill)
4. **[Human]** — Review and commit (phases 7–8)
5. **[Next day]** — New staging created; cycle repeats

**Result**: Data is consolidated daily; synthesis happens on demand or via skill automation.

---

## Security Considerations

### Task Runs As

By default, tasks run as the logged-in user (Interactive logon type).

**To run as service account**:
```powershell
# Modify Principal in setup script
$Principal = New-ScheduledTaskPrincipal `
    -UserId "NT AUTHORITY\SYSTEM" `
    -LogonType ServiceAccount
```

### Logs Are World-Readable

Logs are stored in `C:\dev\kb-sync\logs\` (same permissions as repo).

**To restrict access**:
```powershell
# Adjust logs directory ACL
icacls C:\dev\kb-sync\logs /inheritance:r /grant:r "${env:USERNAME}:F"
```

### No Credentials in Scripts

All scripts use git/npm credentials from `.git/config` and `~\.npmrc` (system-level, not hardcoded).

---

## Maintenance

### Update Tasks

Re-run setup script to update all tasks (safe, non-destructive):

```powershell
.\scripts\setup-scheduled-tasks.ps1
```

### Monitor Health

```powershell
# Check last 7 days of task runs
Get-ScheduledTaskInfo -TaskName "KB-Sync-*" | Format-Table TaskName, LastRunTime, LastTaskResult

# 0 = Success, non-zero = Failure
```

### Rotate Logs

Logs are time-stamped; old logs naturally accumulate. Manual cleanup:

```powershell
# Keep logs from last 30 days
Get-ChildItem C:\dev\kb-sync\logs\*.log | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item
```

---

## Next Steps

1. **Run setup**: `.\scripts\setup-scheduled-tasks.ps1` (as Administrator)
2. **Verify**: `.\scripts\setup-scheduled-tasks.ps1 -List`
3. **Monitor tomorrow**: Check `logs/` directory at 01:00 UTC
4. **Manual synthesis**: When prompted in logs, open Claude Code and run wiki synthesis (phases 1–8)
5. **Automate synthesis** (optional): Invoke obsidian-ingest-wiki skill from scheduled task

---

## Related Documentation

- `docs/targets/obsidian.md` — Three-layer vault architecture
- `modules/wiki/operator-workflow.md` — 8-phase synthesis workflow
- `README.md` — Project overview
