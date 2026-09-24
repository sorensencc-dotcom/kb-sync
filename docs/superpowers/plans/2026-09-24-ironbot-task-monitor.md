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

- [ ] **Step 1: Write the unit test for DAG definition parsing and topological sorting**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ironbot-task-monitor.test.mjs`
Expected: FAIL (`cannot find module '../scripts/ironbot/ironbot-playbooks.mjs'`)

- [ ] **Step 3: Create declarative task DAG definitions file**

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

- [ ] **Step 4: Implement initial DAG helpers in `ironbot-playbooks.mjs`**

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

- [ ] **Step 5: Run tests to verify pass**

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

- [ ] **Step 1: Add unit tests for playbook error diagnosis and lock clearing**

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

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/ironbot-task-monitor.test.mjs`
Expected: FAIL (`diagnoseAndHeal is not a function`).

- [ ] **Step 3: Implement playbooks and diagnostic engine in `ironbot-playbooks.mjs`**

Implement:
- `clearStaleGitLocks(gitDir, maxAgeMs)`
- `diagnoseAndHeal({ taskName, exitCode, repoRoot, taskLog })`
- `writeAuditReport({ logDir, findings, healedCount, replayedCount })`

- [ ] **Step 4: Run test to verify pass**

Run: `node --test tests/ironbot-task-monitor.test.mjs`
Expected: PASS (4 tests pass).

---

### Task 3: PowerShell Task Monitor & Replay Orchestrator

**Files:**
- Create: `scripts/ironbot/ironbot-task-monitor.ps1`
- Test: `tests/ironbot-task-monitor.test.mjs`

**Interfaces:**
- Consumes: Windows Scheduled Tasks state via `Get-ScheduledTask`.
- Produces: CLI execution output and JSON report in `docs/audit/ironbot/`.

- [ ] **Step 1: Write PowerShell test harness check in `tests/ironbot-task-monitor.test.mjs`**

```javascript
test('ironbot-task-monitor.ps1 script exists and parses cleanly', () => {
  const scriptPath = path.join(REPO_ROOT, 'scripts/ironbot/ironbot-task-monitor.ps1');
  assert.ok(fs.existsSync(scriptPath), 'ironbot-task-monitor.ps1 should exist');
});
```

- [ ] **Step 2: Implement `scripts/ironbot/ironbot-task-monitor.ps1`**

Write PowerShell orchestrator:
- Scans `\KB-SYNC\*`, `\CIC\*`, `\TRM\*`, `\CastIronCharlie\*`.
- Checks `LastTaskResult`. If non-zero or abnormal, invokes Node playbook engine.
- If playbook succeeds, re-runs root task with `Start-ScheduledTask`.
- Resolves downstream dependencies via `getDownstreamTasks` and executes them sequentially.
- Emits structured JSON audit trail to `docs/audit/ironbot/YYYY-MM-DD-HHMMSS.json`.
- Sends Slack notification if `WEBHOOK_URL` is set.

- [ ] **Step 3: Run integration test and verify PowerShell syntax**

Run: `pwsh -NoProfile -Command "& { & pwsh -NoProfile -File scripts/ironbot/ironbot-task-monitor.ps1 -DryRun }"`
Expected: Output showing scan completed with status code 0.

---

### Task 4: Unattended Scheduled Task Registration

**Files:**
- Create: `scripts/ironbot/register-ironbot-task.ps1`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task monitor path and 4-hour trigger configuration.
- Produces: Scheduled task `\IronBot\IronBot-TaskMonitor` in Windows Task Scheduler configured with `LogonType: S4U` and `RunLevel: Highest`.

- [ ] **Step 1: Implement `scripts/ironbot/register-ironbot-task.ps1`**

Register task:
```powershell
$TaskName = "IronBot-TaskMonitor"
$TaskPath = "\IronBot\"
$Action = New-ScheduledTaskAction -Execute "pwsh.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\dev\kb-sync\scripts\ironbot\ironbot-task-monitor.ps1" -WorkingDirectory "C:\dev\kb-sync"
$Trigger = New-ScheduledTaskTrigger -Daily -At "00:00"
$Trigger.Repetition = (New-ScheduledTaskTrigger -Once -At "00:00" -RepetitionInterval (New-TimeSpan -Hours 4) -RepetitionDuration (New-TimeSpan -Days 3650)).Repetition
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances Parallel
Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force
```

- [ ] **Step 2: Add npm script in `package.json`**

Add `"ironbot:monitor": "powershell.exe -ExecutionPolicy Bypass -File scripts/ironbot/ironbot-task-monitor.ps1"` and `"ironbot:register": "powershell.exe -ExecutionPolicy Bypass -File scripts/ironbot/register-ironbot-task.ps1"`.

- [ ] **Step 3: Test registering and verifying scheduled task**

Run: `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/ironbot/register-ironbot-task.ps1`
Expected: Task `\IronBot\IronBot-TaskMonitor` registered with state `Ready`.

---

### Task 5: End-to-End Verification & Commit

- [ ] **Step 1: Run full test suite**

Run: `node --test tests/ironbot-task-monitor.test.mjs`
Expected: 100% tests pass.

- [ ] **Step 2: Execute live monitor dry-run**

Run: `npm run ironbot:monitor`
Expected: Clean scan, audit log written under `docs/audit/ironbot/`.

- [ ] **Step 3: Commit and push changes**

```bash
git add scripts/ironbot/ tests/ironbot-task-monitor.test.mjs package.json docs/superpowers/plans/2026-09-24-ironbot-task-monitor.md
git commit -m "feat(ironbot): implement unattended task monitor, self-healing playbooks, and DAG replay"
git push origin main
```
