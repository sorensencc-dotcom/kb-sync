import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

for (const failure of ['missing', 'timeout']) for (const required of [true, false]) {
  test(`Obsidian ${failure} Bash ${required ? 'fails required coverage' : 'reports skip without PASS'}`, context => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-coverage-'));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const preload = path.join(directory, 'subprocess.mjs');
    fs.writeFileSync(preload, `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
childProcess.execSync = (command, options) => {
  if (${JSON.stringify(failure)} === 'missing') throw new Error('Bash unavailable');
  if (command.includes('--version')) return Buffer.from('GNU bash');
  if (options?.env?.MODULE_CONFIG?.includes('_invalid_obsidian_test.yaml')) throw Object.assign(new Error('Invalid vault'), { stderr: 'OBSIDIAN_VAULT_ROOT missing', status: 1 });
  if (command.includes('--incremental --full')) throw Object.assign(new Error('Conflicting flags'), { status: 2 });
  throw Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' });
};
syncBuiltinESMExports();
`);
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(preload).href, 'tests/obsidian-sync-verification.ts'], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, REQUIRE_BASH_COVERAGE: String(required) },
    });
    assert.ifError(result.error);
    assert.equal(result.status, required ? 1 : 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /\[PASS\].*Staging script stages raw sources/);
    assert.match(result.stdout + result.stderr, required ? /REQUIRE_BASH_COVERAGE/ : /SKIPPED/);
  });
}
