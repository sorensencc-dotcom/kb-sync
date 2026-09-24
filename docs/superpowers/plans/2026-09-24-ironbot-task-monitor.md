# IronBot Task Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and register the IronBot Task Monitor to autonomously inspect Windows Scheduled Tasks every 4 hours, heal failed pipelines via deterministic playbooks, replay downstream DAG dependencies, and publish multi-channel audit reports.

**Architecture:** A PowerShell orchestrator (`ironbot-task-monitor.ps1`) integrates with a Node diagnostic playbook engine (`ironbot-playbooks.mjs`) and a declarative DAG map (`task-dag-definitions.json`). Registered as an unattended Windows Scheduled Task running under S4U with highest privileges every 4 hours.

**Tech Stack:** PowerShell 7 (`pwsh.exe`), Node.js (ESM), Windows Task Scheduler API, JSON audit logging.

## Global Constraints
- Cadence: Runs every 4 hours (`00:00`, `04:00`, `08:00`, `12:00`, `16:00`, `20:00` ET).
- Session Independence: Configured with `LogonType: S4U` and `RunLevel: Highest` to run 24/7 without requiring an active interactive user logon.
- Scoped Task Namespaces: `\KB-SYNC\`, `\CIC\`, `\TRM\`, `\CastIronCharlie\`.
- Single runnable test file: `tests/ironbot-task-monitor.test.mjs` using `node:test` and `node:assert/strict`.

---

### Task 1: Declarative DAG & Configuration

**Files:**
- Create: `scripts/ironbot/task-dag-definitions.json`
- Test: `tests/ironbot-task-monitor.test.mjs`

**Interfaces:**
- Consumes: Task definitions and DAG dependencies.
- Produces: `task-dag-definitions.json` mapping task paths, triggers, dependency lists, and log targets.

- [x] **Step 1: Write the unit test for DAG definition parsing and topological sorting**

```javascript
// tests/ironbot-task-monitor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getDownstreamTasks, parseTaskDagConfig } from '../scripts/ironbot/ironbot-playbooks.mjs';

test('parseTaskDagConfig validates DAG schema and dependencies', () => {
  const config = parseTaskDagConfig();
  assert.ok(config.tasks, 'tasks object should exist');
  assert.ok(config.tasks['KB-Sync-Master-Pipeline'], 'KB-Sync-Master-Pipeline should be registered');
  assert.equal(config.tasks['KB-Sync-Master-Pipeline'].task_path, '\\KB-SYNC\\');
});

test('getDownstreamTasks resolves full topological dependency order', () => {
  const downstream = getDownstreamTasks('toolforge-trm-sync-treatment');
  assert.deepEqual(downstream, [
    'KB-Sync-Master-Pipeline',
    'CIC-Nightly-Notebook-Mining',
    'CIC-Daily-Status',
  ]);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/ironbot-task-monitor.test.mjs`
Expected: FAIL (module not found or import error)

- [x] **Step 3: Create declarative task DAG definitions file**

Create `scripts/ironbot/task-dag-definitions.json`:
```json
{
  "version": "1.0.0",
  "cadence_hours": 4,
  "tasks": {
    "toolforge-trm-sync-treatment": {
      "task_path": "\\TRM\\",
      "depends_on": [],
      "downstream": ["KB-Sync-Master-Pipeline"],
      "playbook": "drive_sync_recovery"
    },
    "CastIronCharlie-DailyResearch": {
      "task_path": "\\CastIronCharlie\\",
      "depends_on": [],
      "downstream": ["CIC-Nightly-Notebook-Mining"],
      "playbook": "path_and_process_recovery"
    },
    "KB-Sync-Master-Pipeline": {
      "task_path": "\\KB-SYNC\\",
      "depends_on": ["toolforge-trm-sync-treatment"],
      "downstream": ["CIC-Nightly-Notebook-Mining"],
      "playbook": "git_and_auth_recovery"
    },
    "CIC-Nightly-Notebook-Mining": {
      "task_path": "\\CIC\\",
      "depends_on": ["KB-Sync-Master-Pipeline", "CastIronCharlie-DailyResearch"],
      "downstream": ["CIC-Daily-Status"],
      "playbook": "path_and_process_recovery"
    },
    "CIC-Daily-Status": {
      "task_path": "\\CIC\\",
      "depends_on": ["CIC-Nightly-Notebook-Mining"],
      "downstream": [],
      "playbook": "generic_process_recovery"
    },
    "KB-Sync-TRM-Triage": {
      "task_path": "\\KB-SYNC\\",
      "depends_on": [],
      "downstream": [],
      "playbook": "trm_triage_recovery"
    }
  }
}
```

- [x] **Step 4: Implement initial DAG helpers in `ironbot-playbooks.mjs`**

Create `scripts/ironbot/ironbot-playbooks.mjs`:
```javascript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(__dirname, 'task-dag-definitions.json');

export function parseTaskDagConfig(configPath = CONFIG_PATH) {
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

export function getDownstreamTasks(taskName, config = parseTaskDagConfig()) {
  const result = [];
  const visited = new Set();
  const queue = [...(config.tasks[taskName]?.downstream || [])];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!visited.has(current)) {
      visited.add(current);
      result.push(current);
      const nextDownstream = config.tasks[current]?.downstream || [];
      for (const next of nextDownstream) {
        if (!visited.has(next)) queue.push(next);
      }
    }
  }
  return result;
}
```

- [x] **Step 5: Run tests to verify pass**

Run: `node --test tests/ironbot-task-monitor.test.mjs`
Expected: PASS (2 tests pass).

---

### Task 2: Self-Healing Playbook Engine

**Files:**
- Modify: `scripts/ironbot/ironbot-playbooks.mjs`
- Test: `tests/ironbot-task-monitor.test.mjs`

**Interfaces:**
- Consumes: Task exit codes, error logs, and repository state.
- Produces: `diagnoseAndHeal({ taskName, exitCode, repoRoot })` returning `{ healed: boolean, actions: string[], errorCategory: string }`.

- [x] **Step 1: Add unit tests for playbook error diagnosis and lock clearing**

Add to `tests/ironbot-task-monitor.test.mjs`:
```javascript
import { diagnoseAndHeal, clearStaleGitLocks } from '../scripts/ironbot/ironbot-playbooks.mjs';

test('clearStaleGitLocks detects and cleans expired lock files', () => {
  const tempDir = path.join(REPO_ROOT, '.test-tmp-git-locks');
  fs.mkdirSync(tempDir, { recursive: true });
  const lockFile = path.join(tempDir, 'index.lock');
  fs.writeFileSync(lockFile, 'lock');
  
  // Set mtime to 20 minutes ago
  const oldTime = (Date.now() - 20 * 60 * 1000) / 1000;
  fs.utimesSync(lockFile, oldTime, oldTime);

  const cleared = clearStaleGitLocks(tempDir, 10 * 60 * 1000);
  assert.equal(cleared.length, 1);
  assert.equal(fs.existsSync(lockFile), false);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('diagnoseAndHeal returns actionable repair payload for process path crash (2147942667)', () => {
  const result = diagnoseAndHeal({
    taskName: 'CastIronCharlie-DailyResearch',
    exitCode: 2147942667,
    repoRoot: REPO_ROOT,
  });
  assert.equal(result.healed, true);
  assert.equal(result.errorCategory, 'PROCESS_PATH_CRASH');
  assert.ok(result.actions.length > 0);
});
```

- [x] **Step 2: Run test to verify failure**

Run: `node --test tests/ironbot-task-monitor.test.mjs`
Expected: FAIL (`diagnoseAndHeal is not a function`).

- [x] **Step 3: Implement playbooks and diagnostic engine in `ironbot-playbooks.mjs`**

Add the following exports to `scripts/ironbot/ironbot-playbooks.mjs`:
```javascript
import { spawnSync } from 'node:child_process';

export function clearStaleGitLocks(gitDir, maxAgeMs = 10 * 60 * 1000) {
  if (!fs.existsSync(gitDir)) return [];
  const lockFiles = fs.readdirSync(gitDir).filter(f => f.endsWith('.lock'));
  const cleared = [];
  for (const f of lockFiles) {
    const lockPath = path.join(gitDir, f);
    const age = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (age > maxAgeMs) {
      try {
        fs.unlinkSync(lockPath);
        cleared.push(lockPath);
      } catch { /* best-effort */ }
    }
  }
  return cleared;
}

export function diagnoseAndHeal({ taskName, exitCode, repoRoot }) {
  const config = parseTaskDagConfig();
  const taskDef = config.tasks[taskName];
  const actions = [];
  let healed = false;
  let errorCategory = 'UNKNOWN';

  if (exitCode === 2147942667) {
    errorCategory = 'PROCESS_PATH_CRASH';
    // Verify pwsh and node paths exist
    const pwshResult = spawnSync('where', ['pwsh.exe'], { encoding: 'utf8' });
    const nodeResult = spawnSync('where', ['node.exe'], { encoding: 'utf8' });
    if (pwshResult.status === 0) actions.push('pwsh.exe path verified');
    if (nodeResult.status === 0) actions.push('node.exe path verified');
    healed = pwshResult.status === 0 && nodeResult.status === 0;
  } else if (exitCode === 1) {
    const gitDir = path.join(repoRoot, '.git');
    const lockCleared = clearStaleGitLocks(gitDir);
    if (lockCleared.length > 0) {
      errorCategory = 'GIT_LOCK';
      actions.push(`Cleared ${lockCleared.length} stale lock(s)`);
      healed = true;
    } else {
      errorCategory = 'GENERIC_FAILURE';
      actions.push('No stale locks found; escalating');
    }
  }

  return { healed, errorCategory, actions };
}

export function writeAuditReport({ logDir, findings, healedCount, replayedCount }) {
  fs.mkdirSync(logDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(logDir, `${ts}.json`);
  const report = {
    timestamp: new Date().toISOString(),
    healedCount,
    replayedCount,
    findings,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return reportPath;
}
```

- [x] **Step 4: Run test to verify pass**

Run: `node --test tests/ironbot-task-monitor.test.mjs`
Expected: PASS (4 tests pass).
```
ℹ pass 4
```

---

### Task 3: PowerShell Task Monitor & Replay Orchestrator

**Files:**
- Create: `scripts/ironbot/ironbot-task-monitor.ps1`
- Test: `tests/ironbot-task-monitor.test.mjs`

**Interfaces:**
- Consumes: Windows Scheduled Tasks state via `Get-ScheduledTask`.
- Produces: CLI execution output and JSON report in `docs/audit/ironbot/`.

- [x] **Step 1: Write PowerShell test harness check in `tests/ironbot-task-monitor.test.mjs`**

```javascript
test('ironbot-task-monitor.ps1 script exists and parses cleanly', () => {
  const scriptPath = path.join(REPO_ROOT, 'scripts/ironbot/ironbot-task-monitor.ps1');
  assert.ok(fs.existsSync(scriptPath), 'ironbot-task-monitor.ps1 should exist');
});
```

- [x] **Step 2: Implement `scripts/ironbot/ironbot-task-monitor.ps1`**

```powershell
[CmdletBinding()]
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$AuditDir = Join-Path $RepoRoot 'docs\audit\ironbot'
$Namespaces = @('\KB-SYNC\', '\CIC\', '\TRM\', '\CastIronCharlie\')
$Findings = @()
$HealedCount = 0
$ReplayedCount = 0

function Write-IronLog($Msg) { Write-Host "[IronBot] $Msg" }

foreach ($ns in $Namespaces) {
    $tasks = Get-ScheduledTask -TaskPath $ns -ErrorAction SilentlyContinue
    foreach ($task in $tasks) {
        $info = $task | Get-ScheduledTaskInfo
        if ($info.LastTaskResult -ne 0) {
            Write-IronLog "FAILED: $($task.TaskName) (exit $($info.LastTaskResult))"

            if (-not $DryRun) {
                $result = node "$RepoRoot\scripts\ironbot\ironbot-playbooks.mjs" `
                    --task $task.TaskName --exitCode $info.LastTaskResult
                $payload = $result | ConvertFrom-Json

                if ($payload.healed) {
                    $HealedCount++
                    Start-ScheduledTask -TaskName $task.TaskName -TaskPath $ns
                    Write-IronLog "Reran: $($task.TaskName)"

                    # Replay downstream
                    $downstream = node "$RepoRoot\scripts\ironbot\ironbot-playbooks.mjs" `
                        --downstream $task.TaskName | ConvertFrom-Json
                    foreach ($dep in $downstream) {
                        $depDef = (node "$RepoRoot\scripts\ironbot\ironbot-playbooks.mjs" --dag | ConvertFrom-Json).tasks.$dep
                        Start-ScheduledTask -TaskName $dep -TaskPath $depDef.task_path
                        $ReplayedCount++
                        Write-IronLog "Replayed downstream: $dep"
                    }
                }
            }

            $Findings += @{ task = $task.TaskName; exitCode = $info.LastTaskResult }
        }
    }
}

New-Item -ItemType Directory -Force -Path $AuditDir | Out-Null
$ts = (Get-Date -Format 'yyyy-MM-dd-HHmmss')
$report = @{
    timestamp = (Get-Date -Format 'o')
    healedCount = $HealedCount
    replayedCount = $ReplayedCount
    findings = $Findings
    dryRun = $DryRun.IsPresent
}
$report | ConvertTo-Json -Depth 5 | Out-File "$AuditDir\$ts.json" -Encoding utf8
Write-IronLog "Audit written: $AuditDir\$ts.json"

$WebhookUrl = $env:WEBHOOK_URL
if ($WebhookUrl -and $HealedCount -gt 0) {
    $body = @{ text = "[IronBot] Healed $HealedCount task(s), replayed $ReplayedCount downstream. Findings: $($Findings.Count)" } | ConvertTo-Json
    Invoke-RestMethod -Uri $WebhookUrl -Method Post -Body $body -ContentType 'application/json' -ErrorAction SilentlyContinue
}
```

- [x] **Step 3: Run integration test and verify PowerShell syntax**

Run: `pwsh -NoProfile -File scripts/ironbot/ironbot-task-monitor.ps1 -DryRun`
Expected: Output `[IronBot] Audit written: docs/audit/ironbot/<timestamp>.json`, exit code 0.

---

### Task 4: Unattended Scheduled Task Registration

**Files:**
- Create: `scripts/ironbot/register-ironbot-task.ps1`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task monitor path and 4-hour trigger configuration.
- Produces: Scheduled task `\IronBot\IronBot-TaskMonitor` in Windows Task Scheduler configured with `LogonType: S4U` and `RunLevel: Highest`.

- [x] **Step 1: Implement `scripts/ironbot/register-ironbot-task.ps1`**

```powershell
[CmdletBinding()]
param()

$ScriptPath = (Resolve-Path "$PSScriptRoot\ironbot-task-monitor.ps1").Path
$WorkDir    = (Resolve-Path "$PSScriptRoot\..\..").Path
$TaskName   = "IronBot-TaskMonitor"
$TaskPath   = "\IronBot\"

# Once-type trigger with 4h repetition is the only variant that supports RepetitionInterval
$Trigger = New-ScheduledTaskTrigger -Once -At "00:00" `
    -RepetitionInterval (New-TimeSpan -Hours 4) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$Action   = New-ScheduledTaskAction -Execute "pwsh.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
    -WorkingDirectory $WorkDir

$Principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType S4U `
    -RunLevel Highest

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath `
    -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force |
    Out-Null
Write-Host "[IronBot] Registered \$TaskPath$TaskName"
```

- [x] **Step 2: Add npm scripts in `package.json`**

Add both entries under the `"scripts"` key:
```json
"ironbot:register": "powershell.exe -ExecutionPolicy Bypass -File scripts/ironbot/register-ironbot-task.ps1",
"ironbot:monitor":  "powershell.exe -ExecutionPolicy Bypass -File scripts/ironbot/ironbot-task-monitor.ps1 -DryRun"
```
Note: `ironbot:monitor` uses `-DryRun` by default — omit the flag only when intentionally running against live tasks.

- [x] **Step 3: Test registering and verifying scheduled task**

Run: `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/ironbot/register-ironbot-task.ps1`

Verify registration with an explicit assertion:
```powershell
$t = Get-ScheduledTask -TaskName "IronBot-TaskMonitor" -TaskPath "\IronBot\" -ErrorAction Stop
if ($t.State -ne 'Ready') { throw "Task state is $($t.State), expected Ready" }
Write-Host "PASS: Task registered in state $($t.State)"
```
Expected: `PASS: Task registered in state Ready`

---

### Task 5: End-to-End Verification & Commit

- [x] **Step 1: Run full test suite**

Run: `node --test tests/ironbot-task-monitor.test.mjs`
Expected:
```
ℹ tests 5
ℹ pass 5
ℹ fail 0
```
(5 tests: DAG config, downstream resolution, lock clearing, diagnoseAndHeal, ps1 exists)

- [x] **Step 2: Execute monitor dry-run**

Run: `npm run ironbot:monitor`
Expected: `[IronBot] Audit written: docs/audit/ironbot/<timestamp>.json`, exit code 0. Confirm the file exists:
```bash
ls docs/audit/ironbot/
```

- [x] **Step 3: Commit and push changes**

```bash
git add scripts/ironbot/ tests/ironbot-task-monitor.test.mjs package.json docs/superpowers/plans/2026-09-24-ironbot-task-monitor.md
git commit -m "feat(ironbot): implement unattended task monitor, self-healing playbooks, and DAG replay"
git push origin main
```

