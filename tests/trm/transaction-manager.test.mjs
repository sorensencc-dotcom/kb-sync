import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  acquireLock,
  atomicWriteJson,
  createTransaction,
} from '../../modules/trm/storage/transaction-manager.mjs';

test('acquireLock auto-evicts stale lockfile after TTL', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-lock-test-'));
  const lockFile = path.join(tmpDir, 'test.lock');
  fs.writeFileSync(lockFile, 'stale');
  const pastTime = new Date(Date.now() - 35000);
  fs.utimesSync(lockFile, pastTime, pastTime);

  const lock = acquireLock(lockFile, { timeoutMs: 1000, staleTtlMs: 30000 });
  assert.ok(lock);
  lock.release();
  assert.equal(fs.existsSync(lockFile), false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('atomicWriteJson writes valid json with a lock-safe rename path', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-write-test-'));
  const target = path.join(tmpDir, 'state.json');

  atomicWriteJson(target, { ok: true });

  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { ok: true });
  assert.equal(fs.readdirSync(tmpDir).some((name) => name.includes('.tmp.')), false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('createTransaction aborts on generation mismatch', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-tx-test-'));
  const tx = createTransaction('run-1', 'nb-1', 2, { baseDir: tmpDir });
  tx.stageMutation('settled_facts', { id: 'F1', fact_id: 'F1', status: 'SETTLED' });

  const committed = tx.commitTransaction(3);

  assert.equal(committed, false);
  assert.equal(fs.existsSync(path.join(tmpDir, 'settled_facts.json')), false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
