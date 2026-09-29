import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClaim, parseNumericRange } from '../../modules/trm/gap-triage-engine.mjs';

test('parseNumericRange handles single values, ranges, and approximations', () => {
  assert.deepEqual(parseNumericRange('6,792 aircraft'), { min: 6792, max: 6792, unit: 'aircraft' });
  assert.deepEqual(parseNumericRange('6400-6500 units'), { min: 6400, max: 6500, unit: 'units' });
  assert.deepEqual(parseNumericRange('~12.5 tons'), { min: 12.5, max: 12.5, unit: 'tons' });
});

test('evaluateClaim flags contradiction when claim falls outside settled tolerance', () => {
  const settled = {
    'FACT-01': {
      fact_id: 'FACT-01',
      entity: 'Willow Run',
      attribute: 'production',
      canonical_value: 8685,
      tolerance_pct: 0,
    },
  };
  const claim = { entity: 'Willow Run', attribute: 'production', raw_value: '6500 aircraft' };

  const res = evaluateClaim(claim, settled);

  assert.equal(res.action, 'CONTRADICTION_DETECTED');
  assert.ok(res.conflictDraftFilename.length <= 64);
});
