import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

for (const notebookId of [undefined, 'current-notebook']) test(`Stage 2 uses ${notebookId ? 'environment' : 'retained'} notebook ID`, context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notebooklm-telemetry-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'scripts/notebooklm'), { recursive: true });
  fs.mkdirSync(path.join(directory, '.nlm_pack'));
  fs.copyFileSync(path.join(repoRoot, 'scripts/notebooklm/generate-kb-sync-artifact.mjs'), path.join(directory, 'scripts/notebooklm/generate-kb-sync-artifact.mjs'));
  fs.writeFileSync(path.join(directory, '.nlm_pack/pack.txt'), 'Fixture knowledge pack');
  fs.writeFileSync(path.join(directory, '.sync-status.json'), JSON.stringify({ notebook_id: 'retained-notebook' }));
  const env = { ...process.env };
  delete env.NOTEBOOK_ID;
  if (notebookId) env.NOTEBOOK_ID = notebookId;
  const result = spawnSync(process.execPath, [path.join(directory, 'scripts/notebooklm/generate-kb-sync-artifact.mjs')], { env, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(fs.readFileSync(path.join(directory, '.sync-status.json'), 'utf8'));
  assert.equal(status.notebook_id, notebookId || 'retained-notebook');
});
