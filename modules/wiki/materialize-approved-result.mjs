import fs from 'node:fs';
import path from 'node:path';
import { TRMSourceResolver } from './trm-source-resolver.mjs';
import { validateTrmPayloadSemantics } from './validate-trm-semantics.mjs';

export async function materializeApprovedResult(result, options = {}) {
  const { stagingRoot, batchId, approved = false, resolveSource } = options;
  if (!stagingRoot || !batchId || typeof resolveSource !== 'function') throw new Error('stagingRoot, batchId, and resolveSource are required');
  if (!approved) throw new Error('research result must be explicitly approved');
  const resolver = new TRMSourceResolver(stagingRoot, { resolveSource });
  const output = await resolver.resolveAndMaterialize(result, batchId, { approved });
  const batchDir = path.join(stagingRoot, 'trm', batchId);
  const payload = JSON.parse(fs.readFileSync(path.join(batchDir, 'payload.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(batchDir, 'sources.manifest.json'), 'utf8'));
  const validation = await validateTrmPayloadSemantics(batchDir, payload, manifest);
  if (!validation.valid) throw new Error(`materialized result failed kb-sync validation: ${JSON.stringify(validation.errors)}`);
  return { batch_id: batchId, task_id: result.task_id, run_id: result.run_id, mappings: output.mappings, validation };
}