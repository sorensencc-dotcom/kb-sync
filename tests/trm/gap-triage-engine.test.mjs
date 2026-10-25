import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClaim, parseNumericRange, slugifyTopicKey } from '../../modules/trm/gap-triage-engine.mjs';

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

test('slugifyTopicKey creates stable slug fragments from titles', () => {
  // Basic cases
  assert.equal(slugifyTopicKey('Hello World'), 'hello-world');
  assert.equal(slugifyTopicKey('SIMPLE'), 'simple');

  // Strip ** markers
  assert.equal(slugifyTopicKey('**Bold Title**'), 'bold-title');
  assert.equal(slugifyTopicKey('** Leading and Trailing **'), 'leading-and-trailing');
  assert.equal(slugifyTopicKey('**Partial** Bold'), 'partial-bold');

  // Stop at ` (`
  assert.equal(slugifyTopicKey('Main Topic (Extra context)'), 'main-topic');
  assert.equal(slugifyTopicKey('**Main Topic** (Extra context)'), 'main-topic');

  // Hyphen trimming and non-alphanumeric replacement
  assert.equal(slugifyTopicKey('---Hello---World---'), 'hello-world');
  assert.equal(slugifyTopicKey('Hello!@#$%^World'), 'hello-world');

  // Truncation at 48 chars
  const longTitle = 'a'.repeat(60);
  assert.equal(slugifyTopicKey(longTitle), 'a'.repeat(48));

  // Truncation respects hyphen trimming at the end
  const titleWithHyphenAtCut = 'a'.repeat(47) + '-b';
  assert.equal(slugifyTopicKey(titleWithHyphenAtCut), 'a'.repeat(47));

  // Falsy/empty
  assert.equal(slugifyTopicKey(''), '');
  assert.equal(slugifyTopicKey(null), '');
  assert.equal(slugifyTopicKey(undefined), '');
});
