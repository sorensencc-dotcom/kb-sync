import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import staleLockSweeper, {
  isPidAlive,
  normalizeWindowsPath,
  reapStaleLock,
  sweepStaleLocks,
  DEFAULT_LOCK_MAX_AGE_MS
} from '../scripts/reconciler/stale-lock-sweeper.mjs';

test('DEFAULT_LOCK_MAX_AGE_MS is 15 minutes', () => {
  assert.equal(DEFAULT_LOCK_MAX_AGE_MS, 15 * 60 * 1000);
});

test('default export exposes all core methods', () => {
  assert.equal(typeof staleLockSweeper.isPidAlive, 'function');
  assert.equal(typeof staleLockSweeper.normalizeWindowsPath, 'function');
  assert.equal(typeof staleLockSweeper.reapStaleLock, 'function');
  assert.equal(typeof staleLockSweeper.sweepStaleLocks, 'function');
});

test('normalizeWindowsPath standardizes Windows drive letters and converts backslashes', () => {
  // Empty / null inputs
  assert.equal(normalizeWindowsPath(''), '');
  assert.equal(normalizeWindowsPath(null), '');
  assert.equal(normalizeWindowsPath(undefined), '');

  // Windows backslash path
  const normalized = normalizeWindowsPath('C:\\dev\\kb-sync\\tests');
  assert.equal(normalized.includes('\\'), false);
  assert.ok(/^[A-Z]:\//i.test(normalized));

  // Mixed slashes
  const mixed = normalizeWindowsPath('C:\\dev/kb-sync\\scripts/reconciler');
  assert.equal(mixed.includes('\\'), false);
  assert.ok(/^[A-Z]:\//i.test(mixed));
});

test('isPidAlive correctly identifies current running process vs inactive PID and edge cases', () => {
  // Active process
  assert.equal(isPidAlive(process.pid), true);
  // String pid representing active process
  assert.equal(isPidAlive(String(process.pid)), true);

  // Dead PIDs
  assert.equal(isPidAlive(9999999), false);
  assert.equal(isPidAlive('9999999'), false);

  // Invalid / non-positive PIDs
  assert.equal(isPidAlive(0), false);
  assert.equal(isPidAlive(-1), false);
  assert.equal(isPidAlive(-100), false);
  assert.equal(isPidAlive(null), false);
  assert.equal(isPidAlive(undefined), false);
  assert.equal(isPidAlive('invalid'), false);
  assert.equal(isPidAlive(''), false);
  assert.equal(isPidAlive(NaN), false);
});

test('reapStaleLock handles non-existent file cleanly', () => {
  const res = reapStaleLock(path.join(os.tmpdir(), 'non-existent-lock-12345.lock'));
  assert.equal(res.reaped, false);
  assert.equal(res.reason, 'NOT_FOUND');

  // Null or empty lock path
  assert.equal(reapStaleLock(null).reaped, false);
  assert.equal(reapStaleLock('').reaped, false);
});

test('reapStaleLock preserves active lock held by live process under max age', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
  const lockFile = path.join(tmpDir, 'active.lock');
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), 'utf8');

  const res = reapStaleLock(lockFile, 60000);
  assert.equal(res.reaped, false);
  assert.equal(res.reason, 'ACTIVE_LOCK');
  assert.equal(res.pid, process.pid);
  assert.ok(fs.existsSync(lockFile));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('reapStaleLock reaps lock held by dead PID or older than maxAgeMs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
  const lockFile = path.join(tmpDir, 'dead.lock');
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 9999999, createdAt: new Date().toISOString() }), 'utf8');

  const res = reapStaleLock(lockFile, 60000);
  assert.equal(res.reaped, true);
  assert.equal(fs.existsSync(lockFile), false);

  // Expired mtime test: live process PID but ageMs > maxAgeMs
  const expiredLock = path.join(tmpDir, 'expired.lock');
  fs.writeFileSync(expiredLock, JSON.stringify({ pid: process.pid, createdAt: new Date(Date.now() - 3600000).toISOString() }), 'utf8');
  // Backdate mtime to 1 hour ago
  const pastTime = (Date.now() - 3600000) / 1000;
  fs.utimesSync(expiredLock, pastTime, pastTime);

  const expRes = reapStaleLock(expiredLock, 60000);
  assert.equal(expRes.reaped, true);
  assert.equal(fs.existsSync(expiredLock), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('reapStaleLock handles corrupted or non-JSON lockfiles by treating PID as inactive', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-corrupt-test-'));

  // Corrupted non-JSON string
  const corruptFile = path.join(tmpDir, 'corrupt.lock');
  fs.writeFileSync(corruptFile, 'not-valid-json-content', 'utf8');

  const res1 = reapStaleLock(corruptFile, 60000);
  assert.equal(res1.reaped, true);
  assert.equal(fs.existsSync(corruptFile), false);

  // Valid JSON but without pid property
  const noPidFile = path.join(tmpDir, 'no-pid.lock');
  fs.writeFileSync(noPidFile, JSON.stringify({ note: 'lock without pid property' }), 'utf8');

  const res2 = reapStaleLock(noPidFile, 60000);
  assert.equal(res2.reaped, true);
  assert.equal(fs.existsSync(noPidFile), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('reapStaleLock catches and reports fs errors gracefully', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-err-test-'));
  const subDir = path.join(tmpDir, 'dir-as-lock.lock');
  fs.mkdirSync(subDir);

  // fs.unlinkSync on a directory throws EPERM/EISDIR on standard platforms
  const res = reapStaleLock(subDir, 0);
  assert.equal(res.reaped, false);
  assert.ok(res.error);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('sweepStaleLocks sweeps direct known files and candidate directories', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'));
  const cacheDir = path.join(tmpDir, '_cache');
  const stagingDir = path.join(tmpDir, '_kb-sync-staging', 'notebook-123');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  // 1. Direct known files
  const staleDirectLock = path.join(cacheDir, 'nlm_ingest.lock');
  fs.writeFileSync(staleDirectLock, JSON.stringify({ pid: 9999999 }), 'utf8');

  // 2. Candidate directory .lock file
  const customLock = path.join(cacheDir, 'worker-custom.lock');
  fs.writeFileSync(customLock, JSON.stringify({ pid: 9999999 }), 'utf8');

  // 3. Subdirectory .lock file
  const staleStagingLock = path.join(stagingDir, '.nlm-sync.lock');
  fs.writeFileSync(staleStagingLock, JSON.stringify({ pid: 9999999 }), 'utf8');

  // 4. Non-lock file in staging dir (should be left untouched)
  const nonLockFile = path.join(stagingDir, 'data.json');
  fs.writeFileSync(nonLockFile, '{"valid": true}', 'utf8');

  const results = sweepStaleLocks({
    rootDir: tmpDir,
    searchDirs: [cacheDir, path.join(tmpDir, '_kb-sync-staging')],
    maxAgeMs: 1000
  });

  assert.ok(results.length >= 3);
  assert.equal(fs.existsSync(staleDirectLock), false);
  assert.equal(fs.existsSync(customLock), false);
  assert.equal(fs.existsSync(staleStagingLock), false);
  assert.equal(fs.existsSync(nonLockFile), true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('sweepStaleLocks tolerates non-existent searchDirs safely', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-empty-test-'));

  const results = sweepStaleLocks({
    rootDir: tmpDir,
    searchDirs: [path.join(tmpDir, 'does-not-exist')],
    maxAgeMs: 1000
  });

  assert.deepEqual(results, []);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
