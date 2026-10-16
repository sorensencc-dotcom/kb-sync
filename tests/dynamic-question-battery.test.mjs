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
  assert.equal(metaKey.uuid, '0caf6707-f8f2-4d2a-acd2-020acead55ba');

  const metaAlias = resolveNotebookMetadata('aviation');
  assert.equal(metaAlias.key, 'willow-run');
  assert.equal(metaAlias.uuid, '6fd7c40b-df90-444b-9c7a-a64682925856');
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
