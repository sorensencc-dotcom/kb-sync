import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

test('Stage 1 exports NOTEBOOK_ID before Stage 2 artifact telemetry runs', () => {
  const script = fs.readFileSync(path.join(repoRoot, 'modules', 'notebooklm', 'ingest-notebooklm.sh'), 'utf8');

  assert.match(script, /export NOTEBOOK_ID\b/, 'Stage 1 must export notebook id to child Node process');
});

test('Stage 2 preserves existing notebook_id instead of writing unknown when env is absent', () => {
  const script = fs.readFileSync(path.join(repoRoot, 'scripts', 'notebooklm', 'generate-kb-sync-artifact.mjs'), 'utf8');

  assert.match(script, /existingStatus\.notebook_id/, 'Stage 2 must read existing status notebook id');
  assert.match(script, /process\.env\.NOTEBOOK_ID\s*\|\|\s*existingStatus\.notebook_id\s*\|\|\s*"unknown"/, 'Stage 2 must prefer env, then previous status, then unknown');
});
