import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  cascadeSourceDeletion,
  computeManifestHash,
  evaluateSourceDelta,
} from '../../scripts/run-closed-loop-research-v2.mjs';

test('computeManifestHash produces identical hash regardless of input source ordering', () => {
  const list1 = [
    { id: 'src-b', modified_at: '2026-09-01', size_bytes: 100 },
    { id: 'src-a', modified_at: '2026-09-01', size_bytes: 200 },
  ];
  const list2 = [
    { id: 'src-a', modified_at: '2026-09-01', size_bytes: 200 },
    { id: 'src-b', modified_at: '2026-09-01', size_bytes: 100 },
  ];
  assert.equal(computeManifestHash(list1), computeManifestHash(list2));
});

test('evaluateSourceDelta reports deleted source ids', () => {
  const delta = evaluateSourceDelta({ source_ids: ['src-a', 'src-b'] }, [{ id: 'src-a' }]);

  assert.equal(delta.deltaType, 'SOURCE_DELETED');
  assert.deepEqual(delta.removedSourceIds, ['src-b']);
});

test('cascadeSourceDeletion marks facts whose evidence disappeared', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-cascade-test-'));
  const factsPath = path.join(tmpDir, 'settled_facts.json');
  fs.writeFileSync(
    factsPath,
    JSON.stringify({ F1: { fact_id: 'F1', source_ids: ['src-b'], status: 'SETTLED' } }),
  );

  cascadeSourceDeletion(['src-b'], factsPath);

  assert.equal(JSON.parse(fs.readFileSync(factsPath, 'utf8')).F1.status, 'EVIDENCE_REMOVED');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
