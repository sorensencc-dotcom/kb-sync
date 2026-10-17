import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  isPidAlive,
  normalizeWindowsPath,
  reapStaleLock,
  sweepStaleLocks
} from '../scripts/reconciler/stale-lock-sweeper.mjs';

test('normalizeWindowsPath standardizes Windows drive letters and converts backslashes', () => {
  const normalized = normalizeWindowsPath('C:\\dev\\kb-sync\\tests');
  assert.equal(normalized.includes('\\'), false);
  assert.ok(normalized.startsWith('C:/') || normalized.startsWith('c:/') || /^[A-Z]:\//i.test(normalized));
});

test('isPidAlive correctly identifies current running process vs inactive PID', () => {
  assert.equal(isPidAlive(process.pid), true);
  // PID 9999999 is virtually guaranteed dead/inactive
  assert.equal(isPidAlive(9999999), false);
  assert.equal(isPidAlive(null), false);
  assert.equal(isPidAlive('invalid'), false);
});

test('reapStaleLock handles non-existent file cleanly', () => {
  const res = reapStaleLock(path.join(os.tmpdir(), 'non-existent-lock-12345.lock'));
  assert.equal(res.reaped, false);
  assert.equal(res.reason, 'NOT_FOUND');
});

test('reapStaleLock preserves active lock held by live process under max age', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
  const lockFile = path.join(tmpDir, 'active.lock');
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), 'utf8');

  const res = reapStaleLock(lockFile, 60000);
  assert.equal(res.reaped, false);
  assert.equal(res.reason, 'ACTIVE_LOCK');
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

  // Expired mtime test
  const expiredLock = path.join(tmpDir, 'expired.lock');
  fs.writeFileSync(expiredLock, JSON.stringify({ pid: process.pid, createdAt: new Date(Date.now() - 3600000).toISOString() }), 'utf8');
  // Backdate mtime
  const pastTime = (Date.now() - 3600000) / 1000;
  fs.utimesSync(expiredLock, pastTime, pastTime);

  const expRes = reapStaleLock(expiredLock, 60000);
  assert.equal(expRes.reaped, true);
  assert.equal(fs.existsSync(expiredLock), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('sweepStaleLocks sweeps candidate directories and unlinks stale locks', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'));
  const cacheDir = path.join(tmpDir, '_cache');
  const stagingDir = path.join(tmpDir, '_kb-sync-staging', 'notebook-123');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  const staleCacheLock = path.join(cacheDir, 'nlm_ingest.lock');
  const staleStagingLock = path.join(stagingDir, '.nlm-sync.lock');
  fs.writeFileSync(staleCacheLock, JSON.stringify({ pid: 9999999 }), 'utf8');
  fs.writeFileSync(staleStagingLock, JSON.stringify({ pid: 9999999 }), 'utf8');

  const results = sweepStaleLocks({
    rootDir: tmpDir,
    searchDirs: [cacheDir, path.join(tmpDir, '_kb-sync-staging')],
    maxAgeMs: 1000
  });

  assert.ok(results.length >= 2);
  assert.equal(fs.existsSync(staleCacheLock), false);
  assert.equal(fs.existsSync(staleStagingLock), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
