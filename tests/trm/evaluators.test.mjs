import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchEvaluator } from '../../modules/trm/evaluators/index.mjs';

test('dispatchEvaluator fails over to Tier C when remote_evaluator_allowed is false', async () => {
  const payload = { targetGap: 'GAP-06', sourceTitle: 'NARA_RG156.pdf' };
  const config = { notebook_id: 'nb-private', remote_evaluator_allowed: false };

  const res = await dispatchEvaluator(payload, config, {
    ollamaUrl: 'http://127.0.0.1:99999',
    ollamaTimeoutMs: 25,
  });

  assert.equal(res.evaluator_used, 'deterministic:template');
  assert.match(res.data, /GAP-06/);
});
