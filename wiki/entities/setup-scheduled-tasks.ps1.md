---
title: "setup-scheduled-tasks.ps1"
category: "utilities"
status: "active"
type: entity
tags: [scripts, automation, task-scheduler]
created: 2026-08-01
---

# `setup-scheduled-tasks.ps1`

`scripts/setup-scheduled-tasks.ps1` registers `kb-sync` tasks into Windows Task Scheduler with pre-flight health checks.

## Key Functions

- **Pre-Flight Validation**: Asserts Node.js, Git, and Auth availability before scheduling.
- **Task Registration**: Registers `KB-Sync-Daily` and `KB-Sync-Wiki-Automate`.

## Related Scripts

- [[kb-sync/entities/register-kb-sync-task.ps1]]
- [[kb-sync/entities/kb-sync-nightly.sh]]
