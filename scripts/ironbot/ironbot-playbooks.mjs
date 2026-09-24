import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');
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

export function clearStaleGitLocks(gitDir, maxAgeMs = 10 * 60 * 1000) {
  if (!fs.existsSync(gitDir)) return [];
  const lockFiles = fs.readdirSync(gitDir).filter(f => f.endsWith('.lock'));
  const cleared = [];
  for (const f of lockFiles) {
    const lockPath = path.join(gitDir, f);
    try {
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (age > maxAgeMs) {
        fs.unlinkSync(lockPath);
        cleared.push(lockPath);
      }
    } catch { /* best-effort */ }
  }
  return cleared;
}

export function diagnoseAndHeal({ taskName, exitCode, repoRoot = REPO_ROOT }) {
  const actions = [];
  let healed = false;
  let errorCategory = 'UNKNOWN';

  if (exitCode === 2147942667) {
    errorCategory = 'PROCESS_PATH_CRASH';
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

// CLI entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.includes('--dag')) {
    console.log(JSON.stringify(parseTaskDagConfig()));
  } else if (args.includes('--downstream')) {
    const idx = args.indexOf('--downstream');
    const taskName = args[idx + 1];
    console.log(JSON.stringify(getDownstreamTasks(taskName)));
  } else if (args.includes('--task')) {
    const taskIdx = args.indexOf('--task');
    const taskName = args[taskIdx + 1];
    const codeIdx = args.indexOf('--exitCode');
    const exitCode = codeIdx !== -1 ? parseInt(args[codeIdx + 1], 10) : 0;
    const result = diagnoseAndHeal({ taskName, exitCode, repoRoot: REPO_ROOT });
    console.log(JSON.stringify(result));
  }
}

