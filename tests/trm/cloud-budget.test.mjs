import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  canDispatchCloudCall,
  recordCloudCallRateLimit,
  recordCloudCallSuccess,
} from '../../modules/trm/evaluators/cloud-budget.mjs';

test('cloud budget trips circuit when max daily calls exceeded', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-budget-test-'));
  const budgetFile = path.join(tmpDir, 'budget.json');

  assert.equal(canDispatchCloudCall(budgetFile, { maxDailyCalls: 2 }), true);
  recordCloudCallSuccess(budgetFile);
  recordCloudCallSuccess(budgetFile);
  assert.equal(canDispatchCloudCall(budgetFile, { maxDailyCalls: 2 }), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('cloud budget rejects calls during cooldown', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-budget-cooldown-test-'));
  const budgetFile = path.join(tmpDir, 'budget.json');

  recordCloudCallRateLimit(budgetFile, 60000);

  assert.equal(canDispatchCloudCall(budgetFile), false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
