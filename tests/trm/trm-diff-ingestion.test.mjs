import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { acquireLock, atomicWriteJson, createTransaction } from '../../modules/trm/storage/transaction-manager.mjs';
import { canonicalizeSpanText, computeSpanHash, normalizeGapText, formatLineageHeader, parseLineageHeader } from '../../modules/trm/gap-normalizer.mjs';
import { canDispatchCloudCall, recordCloudCallSuccess, recordCloudCallRateLimit } from '../../modules/trm/evaluators/cloud-budget.mjs';
import { dispatchEvaluator } from '../../modules/trm/evaluators/index.mjs';
import { computeManifestHash, evaluateSourceDelta, cascadeSourceDeletion } from '../../scripts/run-closed-loop-research-v2.mjs';
import { parseNumericRange, evaluateClaim } from '../../modules/trm/gap-triage-engine.mjs';

test('TEST-DIFF-01: Manifest unchanged exits early with NO_DELTA', () => {
  const sources = [{ id: 'src-1', modified_at: '2026-09-01', size_bytes: 500, etag: 'v1' }];
  const delta = evaluateSourceDelta({ source_ids: ['src-1'] }, sources);
  assert.equal(delta.deltaType, 'NO_DELTA');
});

test('TEST-DIFF-02: Manifest delta detected with added source', () => {
  const sources = [
    { id: 'src-1', modified_at: '2026-09-01', size_bytes: 500 },
    { id: 'src-2', modified_at: '2026-09-02', size_bytes: 1200 }
  ];
  const delta = evaluateSourceDelta({ source_ids: ['src-1'] }, sources);
  assert.equal(delta.deltaType, 'DELTA_DETECTED');
});

test('TEST-DIFF-03: Deletion detected triggers SOURCE_DELETED and cascades to facts', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-del-test-'));
  const factsFile = path.join(tmpDir, 'settled_facts.json');
  const initialFacts = {
    'FACT-01': { fact_id: 'FACT-01', source_ids: ['src-2'], status: 'SETTLED' },
    'FACT-02': { fact_id: 'FACT-02', source_ids: ['src-1'], status: 'SETTLED' }
  };
  fs.writeFileSync(factsFile, JSON.stringify(initialFacts));

  const delta = evaluateSourceDelta({ source_ids: ['src-1', 'src-2'] }, [{ id: 'src-1' }]);
  assert.equal(delta.deltaType, 'SOURCE_DELETED');
  assert.deepEqual(delta.removedSourceIds, ['src-2']);

  cascadeSourceDeletion(delta.removedSourceIds, factsFile);
  const updated = JSON.parse(fs.readFileSync(factsFile, 'utf8'));
  assert.equal(updated['FACT-01'].status, 'EVIDENCE_REMOVED');
  assert.equal(updated['FACT-02'].status, 'SETTLED');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TEST-DIFF-05B: Evaluator fails closed to Tier C when remote_evaluator_allowed is false', async () => {
  const payload = { targetGap: 'GAP-06', sourceTitle: 'Doc.pdf' };
  const config = { notebook_id: 'nb-private', remote_evaluator_allowed: false };
  const res = await dispatchEvaluator(payload, config, { ollamaUrl: 'http://127.0.0.1:99999' });
  assert.equal(res.evaluator_used, 'deterministic:template');
});

test('TEST-DIFF-05C: Cloud budget limiter trips when max daily limit reached', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-bgt-test-'));
  const bFile = path.join(tmpDir, 'bgt.json');
  assert.equal(canDispatchCloudCall(bFile, { maxDailyCalls: 1 }), true);
  recordCloudCallSuccess(bFile);
  assert.equal(canDispatchCloudCall(bFile, { maxDailyCalls: 1 }), false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TEST-DIFF-06: Excerpt quote and whitespace jitter produces identical span hash', () => {
  const h1 = computeSpanHash('src-1', canonicalizeSpanText('“Willow  Run”  produced 6,792 flyaways [^1].'));
  const h2 = computeSpanHash('src-1', canonicalizeSpanText('"Willow Run" produced 6,792 flyaways .'));
  assert.equal(h1, h2);
});

test('TEST-DIFF-07: Markdown table row reordering produces identical normalized text', () => {
  const t1 = '| Model | Volume |\n|---|---|\n| B-24J | 500 |\n| B-24E | 100 |';
  const t2 = '| Model | Volume |\n|---|---|\n| B-24E | 100 |\n| B-24J | 500 |';
  assert.equal(normalizeGapText(t1), normalizeGapText(t2));
});

test('TEST-DIFF-08: Staged Lineage Header format and round-trip parse', () => {
  const meta = { span_hash: 'abc123', source_id: 'src-1', generation: 2, run_id: 'run-99' };
  const header = formatLineageHeader(meta);
  const parsed = parseLineageHeader(header);
  assert.deepEqual(parsed, meta);
});

test('TEST-DIFF-09: Numeric range comparator detects discrepancy outside tolerance', () => {
  const settled = {
    'FACT-01': {
      fact_id: 'FACT-01',
      entity: 'Willow Run',
      attribute: 'production',
      canonical_value: 8685,
      tolerance_pct: 0.0
    }
  };
  const claim = { notebook_id: 'willow-run', entity: 'Willow Run', attribute: 'production', raw_value: '6400-6500 aircraft' };
  const res = evaluateClaim(claim, settled);
  assert.equal(res.action, 'CONTRADICTION_DETECTED');
  assert.ok(res.conflictDraftFilename.startsWith('rfc-gap-conflict-willow-run-FACT-01-'));
});

test('TEST-DIFF-10: Settled fact claim matching baseline within tolerance is confirmed', () => {
  const settled = {
    'FACT-01': {
      fact_id: 'FACT-01',
      entity: 'Willow Run',
      attribute: 'production',
      canonical_value: 8685,
      tolerance_pct: 0.05
    }
  };
  const claim = { entity: 'Willow Run', attribute: 'production', raw_value: '8685 aircraft' };
  const res = evaluateClaim(claim, settled);
  assert.equal(res.action, 'FACT_CONFIRMED');
});

test('TEST-DIFF-12: Multi-file WAL transaction aborts on generation conflict', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-wal-test-'));
  const tx = createTransaction('run-101', 'nb-test', 1, { baseDir: tmpDir });
  tx.stageMutation('settled_facts', { id: 'F1', status: 'SETTLED' });
  const success = tx.commitTransaction(2); // live generation is 2, mismatch with captured 1
  assert.equal(success, false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TEST-DIFF-14: Stale lockfile is auto-evicted after TTL', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-lock-'));
  const lockPath = path.join(tmpDir, 'test.lock');
  fs.writeFileSync(lockPath, '12345');
  const past = new Date(Date.now() - 40000);
  fs.utimesSync(lockPath, past, past);

  const lock = acquireLock(lockPath, { timeoutMs: 1000, staleTtlMs: 30000 });
  assert.ok(lock);
  lock.release();
  assert.equal(fs.existsSync(lockPath), false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
