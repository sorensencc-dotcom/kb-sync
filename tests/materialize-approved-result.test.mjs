import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { materializeApprovedResult } from '../modules/wiki/materialize-approved-result.mjs';

const text = 'A grounded source passage.';
const revision = `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
const result = { schema: 'research.result.v1', task_id: 'TASK-CLI', run_id: 'RUN-CLI', status: 'completed', producer: { engine: 'test', provider: 'fixture', model: 'fixture', prompt_version: 'v1' }, requires_approval: true, payload: { target_claim_ids: [], findings: [{ type: 'observation', source_id: 'SRC-1', source_revision: revision, source_span: { start: 0, end: 10, span_hash: `sha256:${crypto.createHash('sha256').update(text.slice(0, 10)).digest('hex')}` }, confidence: 0.9, rationale: 'grounded' }] } };

function options(root, approved = true) { return { stagingRoot: root, batchId: 'batch-cli-test', approved, resolveSource: () => ({ title: 'Source 1', url: 'https://example.test/1', retrieved_at: '2026-08-22T12:00:00Z', text, revision }) }; }

test('returns a machine-readable receipt after approved materialization', async () => {
  const receipt = await materializeApprovedResult(result, options(fs.mkdtempSync(path.join(os.tmpdir(), 'trm-cli-'))));
  assert.deepEqual(Object.keys(receipt), ['batch_id', 'task_id', 'run_id', 'mappings', 'validation']);
  assert.equal(receipt.task_id, 'TASK-CLI');
  assert.equal(receipt.validation.valid, true);
});

test('rejects unapproved results at the boundary', async () => {
  await assert.rejects(() => materializeApprovedResult(result, options(fs.mkdtempSync(path.join(os.tmpdir(), 'trm-cli-')), false)), /approved/);
});