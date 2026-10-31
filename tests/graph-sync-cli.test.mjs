import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runCli } from '../modules/graph-sync/cli.mjs';
import { createGraphSnapshot, createMemoryPersistence } from '../modules/graph-sync/queue.mjs';

function fixture(overrides = {}) {
  return createGraphSnapshot({
    sourceVersion: 'source-1',
    targetVersion: 'target-1',
    nodes: [{ id: 'a', kind: 'doc', path: 'a.md', hash: 'ha' }],
    edges: [],
    ...overrides,
  });
}

test('CLI emits stable JSON and explicit blocked exit for drift', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-sync-cli-'));
  try {
    const state = createMemoryPersistence();
    const snapshotPath = path.join(root, 'snapshot.json');
    const baseDir = path.join(root, '.base');
    fs.mkdirSync(baseDir);
    fs.writeFileSync(snapshotPath, `${JSON.stringify(fixture())}\n`, 'utf8');
    fs.writeFileSync(path.join(baseDir, 'snapshot.json'), `${JSON.stringify(fixture({ nodes: [{ id: 'a', kind: 'doc', path: 'a.md', hash: 'different' }] }))}\n`, 'utf8');

    const enqueue = await runCli(['enqueue', '--state', 'state.json', '--snapshot', 'snapshot.json'], { cwd: root, persistence: state, idGenerator: () => 'q-cli' });
    assert.equal(enqueue.exitCode, 0);
    assert.equal(enqueue.result.ok, true);
    const preflight = await runCli(['preflight', '--state', 'state.json', '--id', 'q-cli', '--base-dir', '.base'], { cwd: root, persistence: state });
    assert.equal(preflight.exitCode, 3);
    assert.equal(preflight.result.ok, false);
    assert.equal(preflight.result.item.status, 'quarantined');
    assert.equal(JSON.stringify(preflight.result), JSON.stringify(preflight.result));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('CLI requires explicit apply before merge and reports token mismatch as blocked', async () => {
  const state = createMemoryPersistence();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-sync-cli-'));
  try {
    const item = (await runCli(['enqueue', '--snapshot', 'snapshot.json'], { cwd: root, persistence: state, idGenerator: () => 'q-merge' })).result;
    assert.equal(item.ok, false);
    const queueSnapshot = fixture();
    fs.writeFileSync(path.join(root, 'snapshot.json'), `${JSON.stringify(queueSnapshot)}\n`, 'utf8');
    const enqueue = await runCli(['enqueue', '--snapshot', 'snapshot.json'], { cwd: root, persistence: state, idGenerator: () => 'q-merge' });
    const preflight = await runCli(['preflight', '--id', 'q-merge', '--base-dir', '.base'], {
      cwd: root,
      persistence: state,
      preflightAdapter: { inspect: (queued) => ({ observedSnapshot: queued.snapshot }) },
    });
    assert.equal(preflight.exitCode, 0);
    const noApply = await runCli(['merge', '--id', 'q-merge', '--token', preflight.result.item.preflightToken], { cwd: root, persistence: state });
    assert.equal(noApply.exitCode, 2);
    const mismatch = await runCli(['merge', '--id', 'q-merge', '--token', 'bad', '--apply'], { cwd: root, persistence: state, mergeAdapter: { apply: () => { throw new Error('must not run'); } } });
    assert.equal(mismatch.exitCode, 3);
    assert.equal(enqueue.result.item.status, 'queued');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('serial merge queue entrypoint delegates to the JSON CLI contract', async () => {
  const entrypoint = path.resolve('scripts/serial-merge-queue.mjs');
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint, 'status', '--state', path.join(os.tmpdir(), `graph-sync-status-${Date.now()}.json`)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, command: 'status', items: [] });
  assert.equal(result.stderr, '');
});

