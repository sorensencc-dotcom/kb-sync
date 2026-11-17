import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const VALIDATOR = path.resolve('modules/wiki/validate-staging-docs.mjs');

test('--diff on a subdirectory target matches changed files (repo-relative vs target-relative paths)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-subdir-'));
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@t.t');
  git('config', 'user.name', 't');
  const sub = path.join(repo, 'vault', 'wiki');
  fs.mkdirSync(sub, { recursive: true });
  const doc = path.join(sub, 'a.md');
  fs.writeFileSync(doc, '---\ntitle: A\n---\n\n# A\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  fs.appendFileSync(doc, '\nchanged\n');

  const r = spawnSync(process.execPath, [VALIDATOR, sub, '--diff'], { encoding: 'utf8', cwd: repo });
  const out = `${r.stdout}${r.stderr}`;
  assert.match(out, /validating 1 changed file/, out);
});
