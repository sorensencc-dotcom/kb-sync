import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runCli(args) {
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 20000
  });
}

test('autoheal-sweeper --fix writes files (dryRun off)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoheal-cli-'));
  const file = path.join(dir, 'note.md');
  fs.writeFileSync(file, '# Title\nbody  \n');
  const result = runCli([
    'modules/wiki/autoheal-sweeper.mjs',
    '--fix',
    '--allow-dirty',
    '--target-dir',
    dir
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const after = fs.readFileSync(file, 'utf8');
  assert.notEqual(after, '# Title\nbody  \n');
  assert.match(after, /---/);
});

test('dashboard copies scoped wiki commands, not validate-batch --fix', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'modules/wiki/dashboard.html'), 'utf8');
  assert.match(html, /validate-staging-docs\.mjs --json=\.\/\.validation-report\.json \./);
  assert.match(html, /validate-staging-docs\.mjs --fix wiki/);
  assert.match(html, /autoheal-sweeper\.mjs --fix --allow-dirty --target-dir wiki/);
  assert.doesNotMatch(html, /wiki:validate-batch -- --fix/);
});
