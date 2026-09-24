// tests/ironbot-task-monitor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDownstreamTasks, parseTaskDagConfig, diagnoseAndHeal, clearStaleGitLocks } from '../scripts/ironbot/ironbot-playbooks.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
