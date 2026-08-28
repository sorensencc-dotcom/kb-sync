import test from 'node:test';
import assert from 'node:assert/strict';
import { runCrossAudit, validatePacket } from '../scripts/cross-audit.mjs';

const packet = {
  packetId: 'kb-sync-test-001',
  specGoal: 'Validate the cross-audit bridge',
  declaredScope: ['scripts/cross-audit.mjs'],
  testOutput: 'fixture failure',
  appliedDiff: '+ bridge',
  historyLog: ['attempt 1']
};

test('runs the shared auditor through the kb-sync adapter', async () => {
  const verdict = await runCrossAudit(packet, {
    generate: async (model, prompt) => {
      assert.equal(model, 'adversarial-auditor');
      assert.match(prompt, /kb-sync-test-001/);
      return JSON.stringify({ consensus: true, blockerAnalysis: 'None', targetedFixRecipe: 'Proceed' });
    }
  });
  assert.deepEqual(verdict, { consensus: true, blockerAnalysis: 'None', targetedFixRecipe: 'Proceed' });
});

test('rejects packets missing required arrays', () => {
  assert.throws(() => validatePacket({ ...packet, historyLog: undefined }), /must be arrays/);
});
