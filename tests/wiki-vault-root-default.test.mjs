import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const config = fs.readFileSync(path.join(root, 'configs/obsidian.yaml'), 'utf8');
const tsx = pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href;

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-root-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'configs'));
  fs.mkdirSync(path.join(dir, 'obsidian/vault'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'configs/obsidian.yaml'), config);
  const env = { ...process.env };
  delete env.OBSIDIAN_VAULT_ROOT;
  return { dir, env };
}

test('drift detection without local .env resolves committed default inside current checkout', (t) => {
  const { dir, env } = fixture(t);
  for (const extension of ['ts', 'js']) {
    const script = `import {resolveStagingPaths} from ${JSON.stringify(new URL(`../modules/wiki/detect-drift.${extension}`, import.meta.url).href)};
      console.log(JSON.stringify(resolveStagingPaths({repoRoot:process.cwd()})));`;
    const result = spawnSync(process.execPath, ['--import', tsx, '--input-type=module', '-e', script], { cwd: dir, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const paths = JSON.parse(result.stdout);
    assert.equal(paths.vaultRoot, path.join(dir, 'obsidian/vault'));
    assert.ok(paths.stagingRoot.startsWith(path.join(dir, 'obsidian/vault')));
  }
});

test('actual synthesis entrypoint uses checkout-local default and preserves explicit override', (t) => {
  const { dir, env } = fixture(t);
  for (const override of [undefined, path.join(dir, 'explicit-vault')]) {
    const expected = override || path.join(dir, 'obsidian/vault');
    fs.mkdirSync(expected, { recursive: true });
    const childEnv = { ...env };
    if (override) childEnv.OBSIDIAN_VAULT_ROOT = override;
    const result = spawnSync(process.execPath, ['--import', tsx, path.join(root, 'modules/obsidian/synthesize-wiki.ts'), '--provider', 'offline-template', '--dry-run'], { cwd: dir, env: childEnv, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const output = (result.stdout + result.stderr).replace(/\u001b\[[0-9;]*m/g, '');
    const actual = output.match(/Resolved Vault Root: (.+)/)?.[1].trim();
    const normalize = value => process.platform === 'win32' ? value.replaceAll('\\', '/').toLowerCase() : value;
    assert.ok(actual, output);
    assert.equal(normalize(actual), normalize(expected));
    assert.match(result.stdout + result.stderr, /staging/i);
    assert.equal(fs.existsSync(path.join(expected, 'wiki')), false, 'Missing staging must not publish wiki pages');
  }
});
