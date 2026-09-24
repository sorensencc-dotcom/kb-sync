// tests/ironbot-task-monitor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDownstreamTasks, parseTaskDagConfig } from '../scripts/ironbot/ironbot-playbooks.mjs';

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
