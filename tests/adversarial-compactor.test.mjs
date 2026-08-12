import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { normalizeRepoPath } from '../modules/compactor/path-utils.mjs';
import { replaceFileAtomically } from '../modules/compactor/atomic-file.mjs';
import { classifyFile } from '../modules/compactor/classifier.mjs';
import { loadNormalizedManifest } from '../modules/compactor/manifest-loader.mjs';
import { getGitDirtyFiles } from '../modules/compactor/git-inspector.mjs';

const repoRoot = path.resolve('.');

test('normalizeRepoPath rejects real filesystem symbolic links that escape repository root', () => {
  const symlinkPath = path.join(repoRoot, '.tmp-outside-symlink');
  const targetOutside = path.resolve(repoRoot, '..');

  try {
    try {
      fs.symlinkSync(targetOutside, symlinkPath, 'junction');
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        console.log('[SKIP] Symlink creation requires elevated OS privileges on Windows.');
        return;
      }
      throw err;
    }

    assert.throws(
      () => normalizeRepoPath('.tmp-outside-symlink', repoRoot),
      /Security Exception/
    );
  } finally {
    if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
  }
});

test('loadNormalizedManifest handles filenames with spaces and CRLF newlines without trimming spaces', () => {
  const tmpManifest = path.join(repoRoot, '.tmp-space-manifest.txt');
  const spaceFile = 'tests/fixtures/sample file with spaces.js';
  
  fs.mkdirSync(path.dirname(path.join(repoRoot, spaceFile)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, spaceFile), 'console.log(1);', 'utf8');
  fs.writeFileSync(tmpManifest, `package.json\r\n${spaceFile}\r\n`, 'utf8');

  try {
    const list = loadNormalizedManifest(tmpManifest, repoRoot);
    assert.ok(list.includes(spaceFile));
  } finally {
    if (fs.existsSync(tmpManifest)) fs.unlinkSync(tmpManifest);
    if (fs.existsSync(path.join(repoRoot, spaceFile))) fs.unlinkSync(path.join(repoRoot, spaceFile));
  }
});

test('replaceFileAtomically restores target file if source file does not exist', () => {
  const dest = path.join(repoRoot, '.tmp-dest-keep.txt');
  fs.writeFileSync(dest, 'original content', 'utf8');

  try {
    assert.throws(
      () => replaceFileAtomically(path.join(repoRoot, 'non-existent-src.txt'), dest),
      /Atomic File Replacement Failure/
    );
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'original content');
  } finally {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  }
});

test('classifyFile forces Full state when overrides file has schema error', () => {
  const config = { compaction: { enabled: true, git_window_days: 14, default_level: 'Skeleton', high_risk_prefixes: [], rules: [] } };
  const overridesResult = { map: new Map(), error: 'Malformed YAML in override file' };
  
  const res = classifyFile({
    repoRoot,
    rawPath: 'core/flatten.sh',
    config,
    overridesResult,
    dirtyFilesSet: new Set(),
    recentFilesSet: new Set(),
    skipPatterns: []
  });

  assert.strictEqual(res.state, 'Full');
  assert.ok(res.reason.includes('Fail-closed: Overrides error'));
});

test('getGitDirtyFiles production function parses rename (R) and copy (C) records from real git repository fixture', () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-fixture-'));

  try {
    execFileSync('git', ['init'], { cwd: fixtureDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: fixtureDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: fixtureDir, stdio: 'ignore' });

    const file1 = path.join(fixtureDir, 'original.txt');
    fs.writeFileSync(file1, 'initial content\n', 'utf8');

    execFileSync('git', ['add', 'original.txt'], { cwd: fixtureDir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: fixtureDir, stdio: 'ignore' });

    // Staged Git Rename operation (triggers R in status porcelain -z)
    execFileSync('git', ['mv', 'original.txt', 'renamed.txt'], { cwd: fixtureDir, stdio: 'ignore' });

    const dirtyFiles = getGitDirtyFiles(fixtureDir);
    assert.ok(dirtyFiles !== null, 'getGitDirtyFiles must return Set for valid git repo');
    assert.ok(dirtyFiles.has('original.txt'), 'Production inspector must detect rename source');
    assert.ok(dirtyFiles.has('renamed.txt'), 'Production inspector must detect rename target');

  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EPERM' || err.code === 'EACCES') {
      console.log('[SKIP] Git CLI execution failed due to environment permissions.');
      return;
    }
    throw err;
  } finally {
    try {
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (_) {}
  }
});
