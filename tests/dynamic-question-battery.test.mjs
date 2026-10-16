import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateContentEntropy,
  calculateBatteryEntropy,
  resolveNotebookMetadata,
  generateDomainFallbackBattery,
  generateDynamicQuestionBattery,
} from '../scripts/mining/dynamic-question-battery.mjs';

test('calculateContentEntropy computes non-zero entropy for rich text', () => {
  const e1 = calculateContentEntropy('hello world this is a test of shannon entropy');
  assert.ok(e1 > 3.0, `Expected entropy > 3.0, got ${e1}`);
  assert.equal(calculateContentEntropy(''), 0);
  assert.equal(calculateContentEntropy(null), 0);
});

test('resolveNotebookMetadata resolves by key and alias from categories.json', () => {
  const metaKey = resolveNotebookMetadata('ford-politics');
  assert.equal(metaKey.key, 'ford-politics');
  assert.match(metaKey.uuid, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);

  const metaAlias = resolveNotebookMetadata('aviation');
  assert.equal(metaAlias.key, 'willow-run');
  assert.match(metaAlias.uuid, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
});

test('generateDomainFallbackBattery generates questions with entropy >= 3.0', () => {
  const meta = resolveNotebookMetadata('ford-politics');
  const questions = generateDomainFallbackBattery(meta);
  assert.equal(questions.length, 4);
  const entropy = calculateBatteryEntropy(questions);
  assert.ok(entropy >= 3.0, `Expected entropy >= 3.0, got ${entropy}`);
});

test('generateDynamicQuestionBattery falls back to domain battery when AST entities < 2', () => {
  const result = generateDynamicQuestionBattery('ford-politics', {
    dbPath: 'non-existent-db-path.db', // forces 0 entities
  });

  assert.equal(result.source, 'domain_fallback');
  assert.equal(result.circuitBreakerSafe, true);
  assert.ok(result.entropy >= 3.0, `Battery entropy must be >= 3.0 to protect circuit breaker`);
  assert.ok(result.questions.length >= 4);
});

test('generateDynamicQuestionBattery gracefully handles completely missing categories and gaps files', () => {
  const result = generateDynamicQuestionBattery('ford-politics', {
    dbPath: 'non-existent-db.db',
    categoriesPath: 'non-existent-categories.json',
    gapsPath: 'non-existent-gaps.md',
  });

  assert.equal(result.source, 'domain_fallback');
  assert.equal(result.circuitBreakerSafe, true);
  assert.equal(result.gapCount, 0);
  assert.ok(result.entropy >= 3.0);
  assert.ok(result.questions.length >= 4);
});

