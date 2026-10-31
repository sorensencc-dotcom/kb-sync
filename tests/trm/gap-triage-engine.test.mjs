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

import fs from 'node:fs';
import path from 'node:path';
import { reconcileResolvedGaps } from '../../modules/trm/gap-triage-engine.mjs';

test('reconcileResolvedGaps returns empty if gaps file is missing', async (t) => {
  t.mock.method(fs, 'existsSync', (p) => false);
  const result = await reconcileResolvedGaps('missing.md');
  assert.deepEqual(result, { resolvedCount: 0, resolvedGaps: [] });
});

test('reconcileResolvedGaps returns empty if no in-progress gaps exist', async (t) => {
  t.mock.method(fs, 'existsSync', (p) => true);
  t.mock.method(fs.promises, 'readFile', async (p) => '- [ ] [GAP-01] Pending gap\n- [x] [GAP-02] Resolved gap\n');
  const result = await reconcileResolvedGaps('gaps.md');
  assert.deepEqual(result, { resolvedCount: 0, resolvedGaps: [] });
});

test('reconcileResolvedGaps returns empty if facts do not match keywords', async (t) => {
  t.mock.method(fs, 'existsSync', (p) => true);
  t.mock.method(fs.promises, 'readFile', async (p) => {
    if (p.endsWith('gaps.md')) {
      return '- [/] [GAP-01] Alpha Beta Gamma\n';
    }
    if (p.endsWith('extracted-facts.json')) {
      return JSON.stringify([{ text: 'Delta Epsilon' }]);
    }
    return '';
  });
  t.mock.method(fs.promises, 'readdir', async (p) => ['topic1']);
  const writeSpy = t.mock.method(fs.promises, 'writeFile', async () => {});

  const result = await reconcileResolvedGaps('gaps.md', { vaultRoot: 'vault' });
  assert.deepEqual(result, { resolvedCount: 0, resolvedGaps: [] });
  assert.equal(writeSpy.mock.callCount(), 0);
});

test('reconcileResolvedGaps updates file if facts match keywords', async (t) => {
  t.mock.method(fs, 'existsSync', (p) => true);
  t.mock.method(fs.promises, 'readFile', async (p) => {
    if (p.endsWith('gaps.md')) {
      return '- [/] [GAP-01] Elephant Giraffe Zebra\n';
    }
    if (p.endsWith('extracted-facts.json')) {
      return JSON.stringify([{ text: 'An elephant and a giraffe and a zebra walked into a bar.' }]);
    }
    return '';
  });
  t.mock.method(fs.promises, 'readdir', async (p) => ['topic1']);
  const writeSpy = t.mock.method(fs.promises, 'writeFile', async () => {});

  const result = await reconcileResolvedGaps('gaps.md', { vaultRoot: 'vault' });
  assert.deepEqual(result, { resolvedCount: 1, resolvedGaps: ['GAP-01--elephant-giraffe-zebra'] });
  assert.equal(writeSpy.mock.callCount(), 1);
  const updatedContent = writeSpy.mock.calls[0].arguments[1];
  assert.ok(updatedContent.includes('- [x] [GAP-01] Elephant Giraffe Zebra'));
});

test('reconcileResolvedGaps matches but skips writing if dryRun is true', async (t) => {
  t.mock.method(fs, 'existsSync', (p) => true);
  t.mock.method(fs.promises, 'readFile', async (p) => {
    if (p.endsWith('gaps.md')) {
      return '- [/] [GAP-01] Elephant Giraffe Zebra\n';
    }
    if (p.endsWith('extracted-facts.json')) {
      return JSON.stringify([{ text: 'An elephant and a giraffe and a zebra walked into a bar.' }]);
    }
    return '';
  });
  t.mock.method(fs.promises, 'readdir', async (p) => ['topic1']);
  const writeSpy = t.mock.method(fs.promises, 'writeFile', async () => {});

  const result = await reconcileResolvedGaps('gaps.md', { vaultRoot: 'vault', dryRun: true });
  assert.deepEqual(result, { resolvedCount: 1, resolvedGaps: ['GAP-01--elephant-giraffe-zebra'] });
  assert.equal(writeSpy.mock.callCount(), 0);
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
