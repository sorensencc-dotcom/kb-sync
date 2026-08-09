import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { acquireLock, verifyPathContainment } from '../modules/wiki/gated-climb-repair.mjs';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gated-climb-test-'));
}

function removeTempDir(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

test('acquireLock creates .gated-climb.lock before validation and releases on request', (t) => {
  const tmpDir = createTempDir();
  t.after(() => removeTempDir(tmpDir));

  const lockPath = path.join(tmpDir, '.gated-climb.lock');
  assert.equal(fs.existsSync(lockPath), false, 'Lock file should not exist initially');

  const lock = acquireLock(tmpDir);
  assert.equal(fs.existsSync(lockPath), true, 'Lock file should be created upon acquiring lock');

  // Attempting to re-acquire active lock must throw lock acquisition error or lock active error
  assert.throws(
    () => acquireLock(tmpDir),
    (err) => {
      assert.ok(
        err.code === 'ERR_LOCK_ACTIVE' ||
        err.code === 'ERR_LOCK_ACQUISITION_FAILED' ||
        /lock/i.test(err.message),
        `Unexpected error: ${err.message}`
      );
      return true;
    },
    'Re-acquiring active lock must throw an error'
  );

  // Release lock
  lock.release();
  assert.equal(fs.existsSync(lockPath), false, 'Lock file should be deleted after release');

  // Re-acquire lock should succeed after release
  const secondLock = acquireLock(tmpDir);
  assert.equal(fs.existsSync(lockPath), true, 'Lock acquisition should succeed after release');
  secondLock.release();
  assert.equal(fs.existsSync(lockPath), false);
});

test('acquireLock detects stale lock when PID is dead or timestamp is expired', (t) => {
  const tmpDir = createTempDir();
  t.after(() => removeTempDir(tmpDir));

  const lockPath = path.join(tmpDir, '.gated-climb.lock');
  // Write a fake stale lock with non-existent PID (e.g. 999999) and old timestamp
  const staleData = JSON.stringify({ pid: 999999, createdAt: Date.now() - 3600000 });
  fs.writeFileSync(lockPath, staleData, 'utf8');

  // acquireLock should detect stale lock, clean it up or allow re-acquisition (or throw stale lock error if configured)
  const lock = acquireLock(tmpDir, { staleMs: 1000 });
  assert.equal(fs.existsSync(lockPath), true, 'Lock file should be re-created for new owner');
  lock.release();
});

test('verifyPathContainment canonicalizes ancestor dirs and allows paths within targetDir', (t) => {
  const tmpDir = createTempDir();
  t.after(() => removeTempDir(tmpDir));

  const subDir = path.join(tmpDir, 'nested', 'dir');
  fs.mkdirSync(subDir, { recursive: true });

  const targetFile = path.join(subDir, 'doc.md');
  fs.writeFileSync(targetFile, '# Test Doc', 'utf8');

  const resolved = verifyPathContainment(tmpDir, targetFile);
  assert.ok(resolved, 'verifyPathContainment should return resolved path');
  assert.equal(
    fs.realpathSync(resolved).toLowerCase(),
    fs.realpathSync(targetFile).toLowerCase()
  );

  // Non-existent file inside existing ancestor
  const nonExistentFile = path.join(subDir, 'new-file.md');
  const resolvedNonExistent = verifyPathContainment(tmpDir, nonExistentFile);
  assert.ok(resolvedNonExistent, 'verifyPathContainment should pass for non-existent file inside valid ancestor');
});

test('verifyPathContainment rejects path traversal outside targetDir with ERR_PATH_TRAVERSAL_VIOLATION', (t) => {
  const tmpDir = createTempDir();
  t.after(() => removeTempDir(tmpDir));

  const outsideFile = path.join(tmpDir, '..', 'outside-secret.txt');

  assert.throws(
    () => verifyPathContainment(tmpDir, outsideFile),
    (err) => {
      assert.equal(err.code, 'ERR_PATH_TRAVERSAL_VIOLATION');
      return true;
    },
    'Should throw ERR_PATH_TRAVERSAL_VIOLATION for path resolving outside targetDir'
  );
});

test('verifyPathContainment rejects symlink pointing outside targetDir', (t) => {
  const tmpDir = createTempDir();
  const outsideDir = createTempDir();
  t.after(() => {
    removeTempDir(tmpDir);
    removeTempDir(outsideDir);
  });

  const symlinkPath = path.join(tmpDir, 'symlink-dir');
  try {
    fs.symlinkSync(outsideDir, symlinkPath, 'junction');
  } catch (err) {
    if (err.code === 'EPERM') {
      t.skip('Skipping symlink test due to permission constraints');
      return;
    }
    throw err;
  }

  const fileViaSymlink = path.join(symlinkPath, 'secret.txt');
  assert.throws(
    () => verifyPathContainment(tmpDir, fileViaSymlink),
    (err) => {
      assert.equal(err.code, 'ERR_PATH_TRAVERSAL_VIOLATION');
      return true;
    },
    'Should reject file paths through symlinks that resolve outside targetDir'
  );
});
