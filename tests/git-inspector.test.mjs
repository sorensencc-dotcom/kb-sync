import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { getGitDirtyFiles, getBulkRecentlyModifiedFiles, getFileContentHash } from '../modules/compactor/git-inspector.mjs';

const repoRoot = path.resolve('.');

test('getFileContentHash returns 12-char SHA-256 hash', () => {
  const hash = getFileContentHash(path.join(repoRoot, 'package.json'));
  assert.strictEqual(typeof hash, 'string');
  assert.strictEqual(hash.length, 12);
  assert.match(hash, /^[0-9a-f]{12}$/);
});

test('getGitDirtyFiles returns a Set of normalized paths or null on failure', () => {
  const dirtyFiles = getGitDirtyFiles(repoRoot);
  assert.ok(dirtyFiles === null || dirtyFiles instanceof Set);
  if (dirtyFiles) {
    for (const file of dirtyFiles) {
      assert.strictEqual(file.includes('\\'), false, 'Path must use POSIX slashes');
      assert.strictEqual(file.startsWith('./'), false, 'Path must not start with ./');
    }
  }
});

test('getBulkRecentlyModifiedFiles returns recent files set', () => {
  const recentFiles = getBulkRecentlyModifiedFiles(repoRoot, 14);
  assert.ok(recentFiles === null || recentFiles instanceof Set);
  if (recentFiles) {
    for (const file of recentFiles) {
      assert.strictEqual(file.includes('\\'), false, 'Path must use POSIX slashes');
    }
  }
});

test('getBulkRecentlyModifiedFiles with 0 days returns empty set', () => {
  const recentFiles = getBulkRecentlyModifiedFiles(repoRoot, 0);
  assert.strictEqual(recentFiles.size, 0);
});

test('getGitDirtyFiles handles invalid directory fail-closed', () => {
  const dirtyFiles = getGitDirtyFiles(path.join(repoRoot, 'non-existent-dir-12345'));
  assert.strictEqual(dirtyFiles, null, 'Must return null (fail-closed) on invalid repo path');
});
