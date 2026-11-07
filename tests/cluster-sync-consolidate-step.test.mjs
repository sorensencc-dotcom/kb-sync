import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareStagedPacks } from '../scripts/pipeline/cluster-sync-runner.mjs';

test('prepareStagedPacks rebuilds packs before a live sweep', () => {
  let calls = 0;
  const out = prepareStagedPacks({ isDryRun: false, consolidateFn: () => { calls++; return [{}, {}]; } });
  assert.equal(calls, 1);
  assert.deepEqual(out, { consolidated: true, packCount: 2 });
});

test('prepareStagedPacks leaves staged packs alone on dry runs and when skipped', () => {
  let calls = 0;
  const consolidateFn = () => { calls++; return []; };
  assert.deepEqual(prepareStagedPacks({ isDryRun: true, consolidateFn }), { consolidated: false, reason: 'dry-run' });
  assert.deepEqual(prepareStagedPacks({ skipConsolidate: true, consolidateFn }), { consolidated: false, reason: 'skipped' });
  assert.equal(calls, 0);
});

test('prepareStagedPacks fails the run when consolidation throws', () => {
  assert.throws(
    () => prepareStagedPacks({ consolidateFn: () => { throw new Error('disk full'); } }),
    /PACK_CONSOLIDATION_FAILED: disk full/
  );
});

test('consolidatePacks defaults to the kb-sync root, and the runner reads its output dir first', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { DEFAULT_ROOT_DIR, DEFAULT_OUT_DIR } = await import('../scripts/consolidate-pack.mjs');
  const { DEFAULT_PACK_CANDIDATE_DIRS } = await import('../scripts/pipeline/cluster-sync-runner.mjs');
  const pkg = JSON.parse(fs.readFileSync(path.join(DEFAULT_ROOT_DIR, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'kb-sync');
  assert.ok(fs.existsSync(path.join(DEFAULT_ROOT_DIR, 'scripts', 'consolidate-pack.mjs')));
  assert.equal(DEFAULT_OUT_DIR, DEFAULT_PACK_CANDIDATE_DIRS[0]);
});
