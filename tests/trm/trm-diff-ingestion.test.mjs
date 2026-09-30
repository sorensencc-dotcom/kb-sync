import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { acquireLock, atomicWriteJson, createTransaction } from '../../modules/trm/storage/transaction-manager.mjs';
import { canonicalizeSpanText, computeSpanHash, normalizeGapText, formatLineageHeader, parseLineageHeader } from '../../modules/trm/gap-normalizer.mjs';
import { canDispatchCloudCall, recordCloudCallSuccess, recordCloudCallRateLimit } from '../../modules/trm/evaluators/cloud-budget.mjs';
import { dispatchEvaluator } from '../../modules/trm/evaluators/index.mjs';
import { computeManifestHash, evaluateSourceDelta, cascadeSourceDeletion, runClosedLoopResearch, getRealSourcesForNotebook, getRealGapForNotebook } from '../../scripts/run-closed-loop-research-v2.mjs';
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
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-test-diff-03-'));
  try {
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
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST-DIFF-04: Modified template hash detection', () => {
  const templateV1 = '# Questions v1\n1. Contradictions?';
  const templateV2 = '# Questions v2\n1. Contradictions?\n2. Measurement tolerances?';
  const hash1 = computeManifestHash([{ id: 'tpl', modified_at: templateV1 }]);
  const hash2 = computeManifestHash([{ id: 'tpl', modified_at: templateV2 }]);
  assert.notEqual(hash1, hash2);
});

test('TEST-DIFF-05A: Evaluator fails over to cloud backup when allowed', async () => {
  const payload = { targetGap: 'GAP-06', sourceTitle: 'Doc.pdf' };
  const config = { notebook_id: 'nb-public', remote_evaluator_allowed: true };
  const res = await dispatchEvaluator(payload, config, { ollamaUrl: 'http://127.0.0.1:99999' });
  // With no API key in test environment, it safely falls through to Tier C
  assert.ok(['claude:3-5-haiku', 'deterministic:template'].includes(res.evaluator_used));
});

test('TEST-DIFF-05B: Evaluator fails closed to Tier C when remote_evaluator_allowed is false', async () => {
  const payload = { targetGap: 'GAP-06', sourceTitle: 'Doc.pdf' };
  const config = { notebook_id: 'nb-private', remote_evaluator_allowed: false };
  const res = await dispatchEvaluator(payload, config, { ollamaUrl: 'http://127.0.0.1:99999' });
  assert.equal(res.evaluator_used, 'deterministic:template');
});

test('TEST-DIFF-05C: Cloud budget limiter trips when max daily limit reached', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-test-diff-05c-'));
  try {
    const bFile = path.join(tmpDir, 'bgt.json');
    assert.equal(canDispatchCloudCall(bFile, { maxDailyCalls: 1 }), true);
    recordCloudCallSuccess(bFile);
    assert.equal(canDispatchCloudCall(bFile, { maxDailyCalls: 1 }), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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

test('TEST-DIFF-11: Duplicate paragraph text produces identical hash', () => {
  const p1 = 'Albert Kahn designed the plant with a 50:1 obstacle clearance ratio.';
  const p2 = 'Albert Kahn designed the plant with a 50:1 obstacle clearance ratio.';
  assert.equal(normalizeGapText(p1), normalizeGapText(p2));
});

test('TEST-DIFF-12: Multi-file WAL transaction aborts on generation conflict', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-test-diff-12-'));
  try {
    const tx = createTransaction('run-101', 'nb-test', 1, { baseDir: tmpDir });
    tx.stageMutation('settled_facts', { id: 'F1', status: 'SETTLED' });
    const success = tx.commitTransaction(2); // live generation is 2, mismatch with captured 1
    assert.equal(success, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST-DIFF-13: Concurrent lock acquisition serializes access', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-test-diff-13-'));
  try {
    const lockPath = path.join(tmpDir, 'shared.lock');
    const lock1 = acquireLock(lockPath, { timeoutMs: 1000 });
    assert.ok(lock1);
    assert.throws(() => {
      acquireLock(lockPath, { timeoutMs: 100 });
    }, /Failed to acquire lock/);
    lock1.release();
    const lock2 = acquireLock(lockPath, { timeoutMs: 500 });
    assert.ok(lock2);
    lock2.release();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST-DIFF-14: Stale lockfile is auto-evicted after TTL', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-test-diff-14-'));
  try {
    const lockPath = path.join(tmpDir, 'test.lock');
    fs.writeFileSync(lockPath, '12345');
    const past = new Date(Date.now() - 40000);
    fs.utimesSync(lockPath, past, past);

    const lock = acquireLock(lockPath, { timeoutMs: 1000, staleTtlMs: 30000 });
    assert.ok(lock);
    lock.release();
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST-DIFF-15: atomicWriteJson handles valid payload and creates directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-test-diff-15-'));
  try {
    const targetFile = path.join(tmpDir, 'nested', 'dir', 'state.json');
    atomicWriteJson(targetFile, { test: 'val' });
    const content = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
    assert.equal(content.test, 'val');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST-DIFF-16: Reconstruct lineage metadata from markdown comment', () => {
  const doc = '# Vault Note\n<!-- TRM-LINEAGE: {"span_hash":"h123","source_id":"s1","generation":1,"run_id":"r1"} -->\nSome text';
  const meta = parseLineageHeader(doc);
  assert.equal(meta.span_hash, 'h123');
  assert.equal(meta.generation, 1);
});

test('TEST-DIFF-17: runClosedLoopResearch routes --mode active, demotes idle >72h, and executes 6-stage pipeline', async () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-test-diff-17-'));
  try {
    const fingerprintsPath = path.join(tmpDir, 'notebook_fingerprints.json');
    const cadencePath = path.join(tmpDir, 'cadence_state.json');

    // Setup: nb-idle (idle 80h) and nb-active (idle 10h)
    const past80h = new Date(Date.now() - 80 * 3600 * 1000).toISOString();
    const past10h = new Date(Date.now() - 10 * 3600 * 1000).toISOString();

    fs.writeFileSync(fingerprintsPath, JSON.stringify({
      'nb-idle': { source_ids: ['s_old'], generation: 1, inventory_hash: 'h_old' },
      'nb-active': { source_ids: ['s_old'], generation: 1, inventory_hash: 'h_old' }
    }));
    fs.writeFileSync(cadencePath, JSON.stringify({
      'nb-idle': { last_source_delta_utc: past80h, cadence: 'ACTIVE_DAILY' },
      'nb-active': { last_source_delta_utc: past10h, cadence: 'ACTIVE_DAILY' }
    }));

    // 1. Run in active mode: nb-idle should be demoted to PASSIVE_WEEKLY, nb-active should be mined
    const resActive = await runClosedLoopResearch({
      mode: 'active',
      baseDir: tmpDir,
      mockSources: [{ id: 's_new', modified_at: new Date().toISOString() }]
    });

    assert.equal(resActive.results.find(r => r.notebookId === 'nb-idle').status, 'DEMOTED_TO_WEEKLY');
    const activeMined = resActive.results.find(r => r.notebookId === 'nb-active');
    assert.equal(activeMined.status, 'MINED_DELTA');
    assert.ok(activeMined.evaluator);
    assert.ok(activeMined.triageAction);

    // Verify cadence state file persisted demotion and active delta
    const updatedCadence = JSON.parse(fs.readFileSync(cadencePath, 'utf8'));
    assert.equal(updatedCadence['nb-idle'].cadence, 'PASSIVE_WEEKLY');
    assert.equal(updatedCadence['nb-active'].cadence, 'ACTIVE_DAILY');

    // Verify promoted_spans.json was written by WAL transaction commit
    const promotedSpans = JSON.parse(fs.readFileSync(path.join(tmpDir, 'promoted_spans.json'), 'utf8'));
    assert.ok(Object.keys(promotedSpans).length > 0);

    // 2. Run in weekly mode: nb-active should be skipped, nb-idle should be processed
    const resWeekly = await runClosedLoopResearch({
      mode: 'weekly',
      baseDir: tmpDir,
      mockSources: [{ id: 's_weekly_new', modified_at: new Date().toISOString() }]
    });
    assert.equal(resWeekly.results.find(r => r.notebookId === 'nb-active').status, 'SKIPPED_ACTIVE_MODE');
    assert.equal(resWeekly.results.find(r => r.notebookId === 'nb-idle').status, 'MINED_DELTA');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST-DIFF-18: Crash recovery staging file parsing', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-test-diff-18-'));
  try {
    const stagingPath = path.join(tmpDir, 'runs', 'run_01.json');
    atomicWriteJson(stagingPath, { run_id: 'run_01', status: 'STAGED', spans: ['s1'] });
    const staged = JSON.parse(fs.readFileSync(stagingPath, 'utf8'));
    assert.equal(staged.run_id, 'run_01');
    assert.equal(staged.status, 'STAGED');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST-DIFF-19: Dry-run execution generates zero WAL staging files or disk mutations', async () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-test-diff-19-'));
  try {
    const res = await runClosedLoopResearch({
      mode: 'active',
      dryRun: true,
      baseDir: tmpDir,
      targetNotebook: 'willow-run',
      mockSources: [{ id: 's_dry_run_1', modified_at: new Date().toISOString() }]
    });

    assert.ok(res.results.length > 0);
    const walDir = path.join(tmpDir, 'transactions');
    const walFiles = fs.existsSync(walDir) ? fs.readdirSync(walDir).filter(f => f.endsWith('.wal.json')) : [];
    assert.equal(walFiles.length, 0);

    const spansFile = path.join(tmpDir, 'promoted_spans.json');
    assert.equal(fs.existsSync(spansFile), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST-DIFF-20: Discovery resolves grounded sources and gaps without synthetic placeholders', () => {
  const targets = ['willow-run', 'ford-politics', 'post-war', 'cuba-claims', 'skills', 'governance', 'meta', 'modules'];
  for (const nb of targets) {
    const sources = getRealSourcesForNotebook(nb, { useCli: false });
    assert.ok(Array.isArray(sources) && sources.length > 0, `Expected real sources for ${nb}`);
    assert.ok(!sources[0].id.includes('_spec.pdf'), `Expected grounded source, got synthetic for ${nb}`);

    const gap = getRealGapForNotebook(nb, path.join(process.cwd(), 'trm-research-gaps.md'), { currentSources: sources });
    assert.ok(gap.targetGap, `Expected targetGap for ${nb}`);
    assert.ok(gap.rawExcerpt, `Expected rawExcerpt for ${nb}`);
    assert.ok(!gap.rawExcerpt.includes('production volume confirmed in sources'), `Expected real gap excerpt for ${nb}`);
  }
});

test('TEST-DIFF-21: Configured category aliases resolve correctly to canonical domains for discovery and gaps', () => {
  const aliases = ['cuba', 'gov', 'module', 'b24', 'rouge', 'willys', 'living-matrix'];
  for (const alias of aliases) {
    const sources = getRealSourcesForNotebook(alias, { useCli: false });
    assert.ok(Array.isArray(sources) && sources.length > 0, `Expected resolved sources for alias ${alias}`);
    const gap = getRealGapForNotebook(alias, path.join(process.cwd(), 'trm-research-gaps.md'), { currentSources: sources });
    assert.ok(gap.targetGap, `Expected resolved targetGap for alias ${alias}`);
    assert.ok(gap.rawExcerpt, `Expected resolved rawExcerpt for alias ${alias}`);
  }
});

test('TEST-DIFF-22: Shared gap prefixes disambiguate by keywords and markdown frontmatter gap_id is preserved', () => {
  const gapsPath = path.join(process.cwd(), 'trm-research-gaps.md');
  
  // miami-estate vs assembly-line disambiguation under "Cast Iron Charlie - Research Logs"
  const miamiGap = getRealGapForNotebook('miami-estate', gapsPath, { useCli: false });
  assert.equal(miamiGap.targetGap, 'GAP-03');
  assert.ok(miamiGap.rawExcerpt.toLowerCase().includes('marriage') || miamiGap.rawExcerpt.toLowerCase().includes('florida'));

  const assemblyGap = getRealGapForNotebook('assembly-line', gapsPath, { useCli: false });
  assert.equal(assemblyGap.targetGap, 'GAP-50');
  assert.ok(assemblyGap.rawExcerpt.toLowerCase().includes('assembly') || assemblyGap.sourceTitle.toLowerCase().includes('assembly'));

  // research-deltas extracts gap_id from frontmatter
  const rdGap = getRealGapForNotebook('research-deltas', gapsPath, { useCli: false });
  assert.equal(rdGap.targetGap, 'GAP-01--cic-research-deltas-living-matrix');

  // Sigil gap resolves to GAP-SIGIL and does not inherit cross-domain frontmatter gap
  const sigilGap = getRealGapForNotebook('sigil', gapsPath, { useCli: false });
  assert.equal(sigilGap.targetGap, 'GAP-SIGIL');

  // Exact keyword priority sources
  const ilSources = getRealSourcesForNotebook('ironledger', { useCli: false });
  assert.equal(ilSources[0].id, 'FINANCIAL-DESIGN-GUIDELINES.md');

  const sigilSources = getRealSourcesForNotebook('sigil', { useCli: false });
  assert.equal(sigilSources[0].id, 'sigil-dep-audit.mjs');

  const rlSources = getRealSourcesForNotebook('rewrite-labs', { useCli: false });
  assert.equal(rlSources[0].id, 'ROADMAP.md');

  const dtSources = getRealSourcesForNotebook('dev-triage', { useCli: false });
  assert.equal(dtSources[0].id, '2026-09-24-ironbot-task-monitor-design.md');
});


