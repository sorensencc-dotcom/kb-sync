import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GraphSyncError,
  GraphSyncQueue,
  compareSnapshots,
  createFilePreflightAdapter,
  createGraphSnapshot,
  createMemoryPersistence,
  parseGraphSnapshot,
} from '../modules/graph-sync/queue.mjs';

function snapshot(overrides = {}) {
  return createGraphSnapshot({
    sourceVersion: 'source-1',
    targetVersion: 'target-1',
    nodes: [
      { id: 'a', kind: 'doc', path: 'a.md', hash: 'ha' },
      { id: 'b', kind: 'doc', path: 'b.md', hash: 'hb' },
    ],
    edges: [{ from: 'a', to: 'b', kind: 'links-to' }],
    ...overrides,
  });
}

test('canonical snapshots are deterministic and immutable', () => {
  const left = snapshot();
  const right = createGraphSnapshot({
    sourceVersion: 'source-1',
    targetVersion: 'target-1',
    nodes: [left.nodes[1], left.nodes[0]],
    edges: [...left.edges],
  });
  assert.equal(left.snapshotHash, right.snapshotHash);
  assert.equal(Object.isFrozen(left), true);
  assert.equal(Object.isFrozen(left.nodes), true);
  assert.throws(() => { left.nodes.push({}); }, TypeError);
});

test('snapshot comparison separates added, removed, changed, rewired, and unknown drift', () => {
  const expected = snapshot();
  const observed = snapshot({
    nodes: [
      { id: 'a', kind: 'doc', path: 'a.md', hash: 'changed' },
      { id: 'c', kind: 'doc', path: 'c.md', hash: 'hc' },
    ],
    edges: [{ from: 'a', to: 'c', kind: 'links-to' }],
  });
  const report = compareSnapshots(expected, observed);
  assert.equal(report.changed.length, 1);
  assert.equal(report.removed.length, 1);
  assert.equal(report.added.length, 1);
  assert.equal(report.rewired.length, 1);
  assert.equal(report.hasDrift, true);
  assert.equal(compareSnapshots(expected, { format: 'bad' }).unknown.length, 1);
});

test('enqueue, preflight, merge, retry, and merge are idempotent', async () => {
  const persistence = createMemoryPersistence();
  const applied = [];
  const queue = new GraphSyncQueue({
    persistence,
    preflightAdapter: { inspect: (item) => ({ observedSnapshot: item.snapshot }) },
    mergeAdapter: { apply: (item) => { applied.push(item.id); return { merged: true }; } },
    idGenerator: () => 'q-1',
    clock: () => 0,
  });
  const first = queue.enqueue({ sourceVersion: 'source-1', targetVersion: 'target-1', snapshot: snapshot() });
  const duplicate = queue.enqueue({ sourceVersion: 'source-1', targetVersion: 'target-1', snapshot: snapshot() });
  assert.equal(first.id, duplicate.id);
  const ready = await queue.preflight(first.id);
  assert.equal(ready.status, 'ready');
  const readyAgain = await queue.preflight(first.id);
  assert.equal(readyAgain.preflightToken, ready.preflightToken);
  const merged = await queue.merge(first.id, ready.preflightToken);
  assert.equal(merged.status, 'merged');
  assert.deepEqual(applied, ['q-1']);
  assert.equal((await queue.merge(first.id, ready.preflightToken)).status, 'merged');
});

test('drift quarantines item and never calls merge', async () => {
  const persistence = createMemoryPersistence();
  let mergeCalls = 0;
  const queue = new GraphSyncQueue({
    persistence,
    preflightAdapter: { inspect: () => ({ observedSnapshot: snapshot({ nodes: [{ id: 'a', kind: 'doc', path: 'a.md', hash: 'different' }] }) }) },
    mergeAdapter: { apply: () => { mergeCalls += 1; } },
    idGenerator: () => 'q-drift',
  });
  const item = queue.enqueue({ sourceVersion: 'source-1', targetVersion: 'target-1', snapshot: snapshot() });
  const quarantined = await queue.preflight(item.id);
  assert.equal(quarantined.status, 'quarantined');
  assert.equal(quarantined.quarantine.expectedHash, item.snapshotHash);
  assert.equal(quarantined.quarantine.retryable, true);
  await assert.rejects(() => queue.merge(item.id, 'invalid'), (error) => error.code === 'TOKEN_MISMATCH');
  assert.equal(mergeCalls, 0);
});

test('missing or malformed base is explicit retryable quarantine', async () => {
  const queue = new GraphSyncQueue({
    persistence: createMemoryPersistence(),
    preflightAdapter: { inspect: () => { throw new GraphSyncError('BASE_MISSING', 'missing .base'); } },
    idGenerator: () => 'q-base',
  });
  const item = queue.enqueue({ sourceVersion: 'source-1', targetVersion: 'target-1', snapshot: snapshot() });
  const result = await queue.preflight(item.id);
  assert.equal(result.status, 'quarantined');
  assert.equal(result.quarantine.reason, 'BASE_MISSING');
  assert.equal(result.quarantine.retryable, true);
});

test('file adapter reads deterministic UTF-8 snapshot and rejects malformed input', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-sync-base-'));
  try {
    fs.writeFileSync(path.join(baseDir, 'snapshot.json'), `${JSON.stringify(snapshot())}\n`, 'utf8');
    const adapter = createFilePreflightAdapter({ baseDir });
    assert.equal(adapter.inspect({}).observedSnapshot.snapshotHash, snapshot().snapshotHash);
    fs.writeFileSync(path.join(baseDir, 'snapshot.json'), '{bad', 'utf8');
    assert.throws(() => adapter.inspect({}), (error) => error.code === 'MALFORMED_SNAPSHOT');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('malformed snapshot hash is rejected before enqueue', () => {
  const invalid = { ...snapshot(), snapshotHash: 'wrong' };
  assert.throws(() => parseGraphSnapshot(invalid), (error) => error.code === 'MALFORMED_SNAPSHOT');
});
