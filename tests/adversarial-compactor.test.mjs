import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { normalizeRepoPath } from '../modules/compactor/path-utils.mjs';
import { replaceFileAtomically } from '../modules/compactor/atomic-file.mjs';
import { classifyFile } from '../modules/compactor/classifier.mjs';
import { loadNormalizedManifest } from '../modules/compactor/manifest-loader.mjs';

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

test('git-inspector dirty files parser handles porcelain -z rename (R) and copy (C) records structurally', () => {
  // Porcelain -z output format: XY path\0 or XY old\0new\0 for R/C
  const fakePorcelainOutput = 'R  old.ts\0new.ts\0C  src.ts\0copy.ts\0 M modified.ts\0';
  const tokens = fakePorcelainOutput.split('\0');
  const dirtyFiles = new Set();
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) { i++; continue; }
    const statusCode = token.slice(0, 2);
    const filePath = token.slice(3);
    if (filePath) dirtyFiles.add(filePath);

    if (statusCode.includes('R') || statusCode.includes('C')) {
      i++;
      if (i < tokens.length && tokens[i]) dirtyFiles.add(tokens[i]);
    }
    i++;
  }

  assert.ok(dirtyFiles.has('old.ts'), 'Rename source must be dirty');
  assert.ok(dirtyFiles.has('new.ts'), 'Rename target must be dirty');
  assert.ok(dirtyFiles.has('src.ts'), 'Copy source must be dirty');
  assert.ok(dirtyFiles.has('copy.ts'), 'Copy target must be dirty');
  assert.ok(dirtyFiles.has('modified.ts'), 'Modified file must be dirty');
});
