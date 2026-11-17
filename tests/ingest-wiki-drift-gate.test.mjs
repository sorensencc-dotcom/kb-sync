import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');

function run(status, extraEnv = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-gate-'));
  const vault = path.join(tmp, 'vault');
  const staging = path.join(vault, 'staging', '20260101-000000');
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'FILES.manifest.txt'), 'a.md\n');
  const report = path.join(tmp, 'drift.json');
  const stub = path.join(tmp, 'stub.mjs');
  fs.writeFileSync(stub,
    `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({status:${JSON.stringify(status)},summary:{stale_pages_count:${status === 'NO_DRIFT' ? 0 : 3}}}));`);
  const r = spawnSync('bash', ['modules/obsidian/ingest-wiki.sh', 'validate', '--staging-path', staging], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      OBSIDIAN_VAULT_ROOT: vault,
      KB_DRIFT_CMD: `node ${JSON.stringify(stub)}`,
      KB_DRIFT_REPORT: report,
      ...extraEnv,
    },
  });
  return r;
}

test('validate fails with exit 3 when drift detected', () => {
  const r = run('DRIFT_DETECTED');
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /drift/i);
});

test('validate passes when no drift', () => {
  const r = run('NO_DRIFT');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('KB_DRIFT_GATE=0 skips the gate', () => {
  const r = run('DRIFT_DETECTED', { KB_DRIFT_GATE: '0' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
