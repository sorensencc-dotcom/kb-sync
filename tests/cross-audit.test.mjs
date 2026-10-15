import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function loadAdapter() {
  let adapter;
  await assert.doesNotReject(async () => { adapter = await import('../scripts/cross-audit.mjs'); });
  return adapter;
}

const packet = {
  packetId: 'kb-sync-test-001',
  specGoal: 'Validate the cross-audit bridge',
  declaredScope: ['scripts/cross-audit.mjs'],
  testOutput: 'fixture failure',
  appliedDiff: '+ bridge',
  historyLog: ['attempt 1']
};

test('runs the shared auditor through the kb-sync adapter', async () => {
  const { runCrossAudit } = await loadAdapter();
  const verdict = await runCrossAudit(packet, {
    generate: async (model, prompt) => {
      assert.equal(model, 'adversarial-auditor');
      assert.match(prompt, /kb-sync-test-001/);
      return JSON.stringify({ consensus: true, blockerAnalysis: 'None', targetedFixRecipe: 'Proceed' });
    }
  });
  assert.deepEqual(verdict, { consensus: true, blockerAnalysis: 'None', targetedFixRecipe: 'Proceed' });
});

test('rejects packets missing required arrays', async () => {
  const { validatePacket } = await loadAdapter();
  assert.throws(() => validatePacket({ ...packet, historyLog: undefined }), /must be arrays/);
});

test('CLI rejects malformed packets from an unrelated working directory', context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-audit-cli-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const packetPath = path.join(directory, 'packet.json');
  fs.writeFileSync(packetPath, JSON.stringify({ ...packet, historyLog: undefined }));
  const result = spawnSync(process.execPath, [path.resolve(import.meta.dirname, '../scripts/cross-audit.mjs'), packetPath], { cwd: directory, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /historyLog must be arrays/);
});
