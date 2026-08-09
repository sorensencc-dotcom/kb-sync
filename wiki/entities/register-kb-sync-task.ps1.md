---
title: "register kb sync task.ps1"
category: "wiki"
status: "active"
---

# register-kb-sync-task.ps1

**Type:** PowerShell Script / Automation  
**Location:** `scripts/register-kb-sync-task.ps1`  
**Status:** Active  
**Last Updated:** 2026-07-25  

## Summary

`register-kb-sync-task.ps1` is a PowerShell script that registers the scheduled task `KB-Sync-Daily` in Windows Task Scheduler. It configures the task to run `npm run kb:sync` daily at 03:00 AM.

## Attributes

- **Input:** Target command (`powershell.exe -Argument "cd C:\dev\kb-sync; npm run kb:sync"`), trigger schedule
- **Output:** Registered Windows Scheduled Task (`KB-Sync-Daily`)
- **Side Effects:** Modifies Windows Task Scheduler registry/settings
- **Performance:** Execution duration ~1s
- **Constraints:** Requires Windows PowerShell and user permissions

## Relationships

- **Called by:** Systems administrator / Operator
- **Calls:** `Register-ScheduledTask`, `New-ScheduledTaskAction`, `New-ScheduledTaskTrigger`
- **Depends on:** Windows Task Scheduler
- **Used in workflows:** Infrastructure Setup & Automation

## Cross-References

- Related entities: [[kb-sync/entities/kb-sync-nightly.sh]], [[kb-sync/entities/ingest-notebooklm.sh]]
- Related concepts: [[kb-sync/concepts/fail-soft-orchestration]]
- Backlinks from: [[kb-sync/wiki/Index]], [[kb-sync/entities/kb-sync-nightly.sh]]

## Source Citations

- **Primary source:** `scripts/register-kb-sync-task.ps1`
