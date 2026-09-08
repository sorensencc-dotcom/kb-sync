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
  assert.match(html, /validate-staging-docs\.mjs --fix --json=\.\/\.validation-report\.json wiki/);
  assert.match(html, /autoheal-sweeper\.mjs --fix --allow-dirty --target-dir wiki/);
  assert.doesNotMatch(html, /wiki:validate-batch -- --fix/);
  assert.match(html, /Reload report JSON/);
});

test('autoheal prefers concepts/ path instead of comma-joining registry hits', async () => {
  const { autohealMetadata } = await import('../modules/wiki/autoheal-sweeper.mjs');
  const index = new Map([
    ['immutable-staging', ['kb-sync/wiki/ImmutableStaging.md', 'concepts/immutable-staging.md']]
  ]);
  const result = await autohealMetadata(
    'concepts/deterministic-sync-pipeline.md',
    '---\ntitle: X\ncategory: concepts\nstatus: active\n---\n\n# X\n\n[[immutable-staging]]\n',
    { index }
  );
  assert.doesNotMatch(result.content, /ImmutableStaging\.md,concepts/);
  assert.match(result.content, /\[\[concepts\/immutable-staging\]\]/);
});

test('validate-staging-docs defaults --json to repo-root report', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'modules/wiki/validate-staging-docs.mjs'), 'utf8');
  assert.match(src, /--no-json/);
  assert.match(src, /\.validation-report\.json/);
  assert.match(src, /jsonFlag \|\| `--json=\$\{path\.join\(root, '\.validation-report\.json'\)\}`/);
});
