import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  validateWatchlist,
  fetchTargetContent,
  performLocalDiff,
  dispatchSigilTask,
  monitorCompetitorWatchlist
} from '../watch-competitors-v2.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function validWatchlist(overrides = {}) {
  return {
    watchlist_id: 'trm:watchlist:test-watch', competitor_name: 'Test competitor',
    targets: [{ target_id: 'test-target', url: 'https://example.com/source', type: 'documentation_page', hash_baseline: hash('baseline') }],
    memory_alignment: { layer2_wiki_path: 'research/test.md', status: 'stable', delta_rules: { trigger_comparison: true } },
    ...overrides
  };
}

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-watch-'));
  try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('accepts a valid watchlist', () => assert.equal(validateWatchlist(validWatchlist()), true));

test('rejects more than 30 targets', () => {
  const targets = Array.from({ length: 31 }, (_, i) => ({ target_id: `target-${i}`, url: 'https://example.test/source', type: 'documentation_page', hash_baseline: hash('baseline') }));
  assert.throws(() => validateWatchlist(validWatchlist({ targets })), /WATCHLIST_LIMIT_EXCEEDED/);
});

test('rejects malformed identifiers, target types, and baseline hashes', () => {
  assert.throws(() => validateWatchlist(validWatchlist({ watchlist_id: 'bad' })), /INVALID_WATCHLIST/);
  const target = validWatchlist().targets[0];
  assert.throws(() => validateWatchlist(validWatchlist({ targets: [{ ...target, target_id: 'Bad ID' }] })), /INVALID_TARGET/);
  assert.throws(() => validateWatchlist(validWatchlist({ targets: [{ ...target, type: 'unknown' }] })), /invalid type/);
  assert.throws(() => validateWatchlist(validWatchlist({ targets: [{ ...target, hash_baseline: 'not-a-sha256' }] })), /hash_baseline/);
});

test('rejects incomplete memory alignment configuration', () => {
  assert.throws(() => validateWatchlist(validWatchlist({ memory_alignment: {} })), /layer2_wiki_path/);
  assert.throws(() => validateWatchlist(validWatchlist({ memory_alignment: { layer2_wiki_path: 'x', status: 'unknown', delta_rules: { trigger_comparison: true } } })), /invalid value/);
  assert.throws(() => validateWatchlist(validWatchlist({ memory_alignment: { layer2_wiki_path: 'x', status: 'stable', delta_rules: {} } })), /trigger_comparison/);
});

test('air-gapped fetch returns known repository fixture', async () => {
  const previous = process.env.AIRGAP; process.env.AIRGAP = 'true';
  try {
    const payload = JSON.parse(await fetchTargetContent({ url: 'https://github.com/google/sam', type: 'git_repo' }));
    assert.equal(payload.repository, 'google/sam'); assert.equal(payload.p2p_mesh, true); assert.match(payload.last_commit_hash, /^[a-f0-9]{40}$/);
  } finally { if (previous === undefined) delete process.env.AIRGAP; else process.env.AIRGAP = previous; }
});

test('local diff identifies missing baseline and includes both inputs', async () => await withTempDir(async (dir) => {
  assert.match(performLocalDiff(path.join(dir, 'missing.md'), 'new payload'), /NEW_CONCEPT/);
  const baseline = path.join(dir, 'baseline.md'); fs.writeFileSync(baseline, 'old payload');
  const diff = performLocalDiff(baseline, 'new payload'); assert.match(diff, /old payload/); assert.match(diff, /new payload/);
}));

test('filesystem dispatcher appends pending task with status and timestamp', async () => await withTempDir(async (dir) => {
  const previous = process.cwd(); process.chdir(dir);
  try {
    dispatchSigilTask(null, { approval_id: 'app_test', action_hash: 'abc' });
    const lines = fs.readFileSync(path.join(dir, 'sigil-queue.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const envelope = JSON.parse(lines[0]);
    assert.equal(envelope.approval.status, 'pending');
    assert.equal(envelope.message_id, 'app_test');
    assert.match(envelope.created_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally { process.chdir(previous); }
}));

test('dry-run monitors targets without writing watchlist state', async () => await withTempDir(async (dir) => {
  const watchlistPath = path.join(dir, 'watchlist.json');
  const original = validWatchlist({ targets: [{ ...validWatchlist().targets[0], url: 'https://github.com/google/sam' }] });
  fs.writeFileSync(watchlistPath, JSON.stringify(original)); const previous = process.env.DRY_RUN; process.env.DRY_RUN = 'true';
  try { const result = await monitorCompetitorWatchlist(watchlistPath); assert.equal(result.totalTargets, 1); assert.equal(result.driftsDetected, 1); assert.deepEqual(JSON.parse(fs.readFileSync(watchlistPath, 'utf8')), original); }
  finally { if (previous === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previous; }
}));
