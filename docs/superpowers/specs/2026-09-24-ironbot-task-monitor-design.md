# IronBot Task Monitor & Pipeline Self-Healing Architecture Spec

## 1. Overview
The IronBot Task Monitor (`IronBot-TaskMonitor`) is an autonomous Windows service and task supervisor designed to monitor, diagnose, repair, and replay scheduled tasks across the `\KB-SYNC\`, `\CIC\`, `\TRM\`, and `\CastIronCharlie\` namespaces. It runs every 4 hours, independent of active user sessions (configured with `LogonType: S4U` / Highest RunLevel), ensuring zero pipeline stalls due to transient crashes, lock contention, or unhandled exceptions.

---

## 2. Core Operational Requirements
1. **Execution Cadence**: Runs every 4 hours (`00:00`, `04:00`, `08:00`, `12:00`, `16:00`, `20:00` ET).
2. **Session Independence**: Configured to run whether the user is logged on or not (`LogonType: S4U` with elevated `Highest` privileges).
3. **Task Scope**:
   * `\KB-SYNC\KB-Sync-Master-Pipeline`
   * `\KB-SYNC\KB-Sync-TRM-Triage`
   * `\CIC\CIC-Nightly-Notebook-Mining`
   * `\CIC\CIC-Daily-Status`
   * `\CastIronCharlie\CastIronCharlie-DailyResearch`
   * `\TRM\CIC-TRM-ClosedLoop-Nightly-Miner`
   * `\TRM\toolforge-trm-sync-treatment`
   * `\TRM\TRM-Notebooklm-Chat-Archive`
   * `\TRM\TRM-Notebooklm-Mine`
4. **Self-Healing Pipeline**:
   * Inspects task `LastTaskResult` and execution timestamps.
   * Diagnoses root causes via exit codes and log files.
   * Executes deterministic playbooks (stale lock release, git state repair, auth refresh, directory verification).
5. **DAG-Based Dependency Replay**:
   * When a broken root task succeeds after healing, triggers all downstream dependent tasks in topological order.
6. **Logging & Multi-Channel Reporting**:
   * Appends structured JSON/Markdown audit entries to `docs/audit/ironbot/`.
   * Dispatches incident and recovery notifications to Slack webhook.
   * Updates Notion operations database.

---

## 3. Architecture & Components

```
+-------------------------------------------------------------+
|               IronBot Task-Bot Orchestrator                |
|      (Runs every 4h via S4U Unattended Task Scheduler)       |
+-------------------------------------------------------------+
                              |
                              v
             [ 1. Scheduled Task Scanner & Filter ]
               - Query \KB-SYNC\, \CIC\, \TRM\, \CastIronCharlie\
               - Identify LastTaskResult != 0 or Stale Run Timestamps
                              |
                              +---> All Healthy? ---> Exit 0 & Log
                              |
                              v
             [ 2. Diagnosis & Playbook Engine ]
               - Crash 2147942667: Resolve missing binary/paths
               - Lock 1: Clear .git/index.lock, MERGE_HEAD
               - Auth 1: Run NLM auth refresh / Drive check
               - Staging error: Run DAG auto-repair / cache sync
                              |
                              v
             [ 3. Target Task Execution & Verify ]
               - Start-ScheduledTask & wait for completion
               - Assert LastTaskResult == 0
                              |
                              v
             [ 4. DAG Downstream Dependency Replay ]
               - Identify dependent tasks in topological order
               - Replay downstream tasks sequentially
                              |
                              v
             [ 5. Multi-Channel Reporting & Audit ]
               - Write docs/audit/ironbot/YYYY-MM-DD.json
               - Send formatted Slack alert
               - Sync Notion status
```

---

## 4. Task Dependency Graph (DAG)

| Task Name | Task Path | Depends On | Triggers Downstream |
| :--- | :--- | :--- | :--- |
| `toolforge-trm-sync-treatment` | `\TRM\` | None (Root) | `KB-Sync-Master-Pipeline` |
| `KB-Sync-Master-Pipeline` | `\KB-SYNC\` | `toolforge-trm-sync-treatment` | `CIC-Nightly-Notebook-Mining` |
| `CIC-Nightly-Notebook-Mining` | `\CIC\` | `KB-Sync-Master-Pipeline` | `CIC-Daily-Status` |
| `CastIronCharlie-DailyResearch` | `\CastIronCharlie\` | None (Root) | `CIC-Nightly-Notebook-Mining` |
| `KB-Sync-TRM-Triage` | `\KB-SYNC\` | None (Independent) | None |

---

## 5. Playbook Self-Healing Matrix

| Exit Code / Symptom | Identified Root Cause | Automated Playbook Action |
| :--- | :--- | :--- |
| `2147942667` | Executable path missing / process crash | Re-registers task with resolved absolute `pwsh.exe` / `node.exe` paths |
| `1` (Git Lock) | `.git/index.lock` or `.git/MERGE_HEAD` present | Tests lock file age (>10m) and removes stale lock |
| `1` (Auth Expired) | NotebookLM / Google Drive auth token expired | Executes `nlm login --check` / Drive API token refresh |
| `1` (Drive Unreachable) | Drive streaming mount unmounted in non-interactive session | Checks alternative local path `%USERPROFILE%\Google Drive` |
| `1` (Wiki Drift / DAG) | Staging validation or DAG broken | Executes `npm run kb:dag:recover` and `npm run wiki:ingest:offline` |

---

## 6. Implementation Plan & File Layout

1. `scripts/ironbot/ironbot-task-monitor.ps1`: Primary PowerShell orchestrator running scan, healing, DAG replay, and reporting.
2. `scripts/ironbot/ironbot-playbooks.mjs`: Node-based diagnostic log parser, error categorizer, and recovery playbook executor.
3. `scripts/ironbot/task-dag-definitions.json`: Declarative JSON configuration mapping task dependencies, log locations, and playbooks.
4. `scripts/ironbot/register-ironbot-task.ps1`: Windows Task Scheduler registration script configuring unattended S4U execution every 4 hours.
5. `tests/ironbot-task-monitor.test.mjs`: Test suite validating DAG resolution, playbook selection, and mock recovery workflows.
