import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { TRMSourceResolver } from '../modules/wiki/trm-source-resolver.mjs';
import { validateTrmPayloadSemantics } from '../modules/wiki/validate-trm-semantics.mjs';

const sourceText = 'The event occurred in Detroit in 1912.';
const sourceRevision = `sha256:${crypto.createHash('sha256').update(sourceText).digest('hex')}`;
const result = {
  schema: 'research.result.v1', task_id: 'TASK-1', run_id: 'RUN-1', status: 'completed',
  producer: { engine: 'torquequery', provider: 'fixture', model: 'fixture', prompt_version: 'v1' },
  requires_approval: true,
  payload: { target_claim_ids: ['C-1'], findings: [{
    type: 'observation', source_id: 'SRC-101', source_revision: sourceRevision,
    source_span: { start: 0, end: 10, span_hash: `sha256:${crypto.createHash('sha256').update(sourceText.slice(0, 10)).digest('hex')}` },
    confidence: 0.95, rationale: 'Directly supported.'
  }] }
};

function setup() { return fs.mkdtempSync(path.join(os.tmpdir(), 'trm-resolver-')); }
function resolver(root) { return new TRMSourceResolver(root, { resolveSource: (id) => id === 'SRC-101' ? { title: 'Source 101', url: 'https://example.test/source-101', retrieved_at: '2026-08-22T12:00:00Z', text: sourceText, revision: sourceRevision } : null }); }

test('rejects unapproved results before writing files', async () => {
  const root = setup();
  await assert.rejects(() => resolver(root).resolveAndMaterialize(result, 'batch-test-1', { approved: false }), /approved/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('materializes canonical findings and passes kb-sync semantic validation', async () => {
  const root = setup();
  const output = await resolver(root).resolveAndMaterialize(result, 'batch-test-2', { approved: true });
  const batch = path.join(root, 'trm', 'batch-test-2');
  const payload = JSON.parse(fs.readFileSync(path.join(batch, 'payload.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(batch, 'sources.manifest.json'), 'utf8'));
  assert.equal(output.mappings[0].incoming_id, 'SRC-101');
  assert.match(payload.sources[0].source_id, /^src-[a-z0-9-]+$/);
  assert.deepEqual(Object.keys(manifest), [payload.sources[0].staged_filename]);
  const validation = await validateTrmPayloadSemantics(batch, payload, manifest);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test('rejects missing source content instead of creating provenance stubs', async () => {
  const root = setup();
  const bad = { ...result, payload: { ...result.payload, findings: [{ ...result.payload.findings[0], source_id: 'SRC-MISSING' }] } };
  await assert.rejects(() => resolver(root).resolveAndMaterialize(bad, 'batch-test-3', { approved: true }), /source content/);
});