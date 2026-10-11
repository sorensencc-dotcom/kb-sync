/**
 * tests/ingest-nlm-runner.test.mjs
 *
 * Unit and integration tests for ingest-nlm-runner.mjs:
 * 1. Preflight Auth Failure: exits with code 2 on invalid auth
 * 2. Payload Budget Enforcement: quarantines files exceeding 380 KiB
 * 3. Idempotency Receipts: skips already synced files on subsequent runs
 * 4. Micro-batch Isolation: isolates single-source failures to dead-letter without terminating the run
 * 5. Concurrency Locking: rejects overlapping runs when lock is held by a live process
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RUNNER_SCRIPT = path.join(REPO_ROOT, 'scripts/notebooklm/ingest-nlm-runner.mjs');
const MOCK_CLI = path.join(__dirname, 'mock-nlm-cli-harness.mjs');

// Create mock CLI harness
fs.writeFileSync(MOCK_CLI, `
const args = process.argv.slice(2);
const mode = process.env.TEST_MOCK_MODE || 'success';

if (args[0] === '--version') {
  console.log('nlm version 0.15.4 (mock)');
  process.exit(0);
}

if (args[0] === 'login' && args[1] === '--check') {
  if (mode === 'auth_fail') {
    console.error('Authentication expired / token revoked');
    process.exit(1);
  }
  console.log('✓ Authentication valid!');
  process.exit(0);
}

if (args[0] === 'source' && args[1] === 'add') {
  const filePath = args[args.indexOf('--file') + 1] || args[args.indexOf('--notebook') + 2];
  if (mode === 'fail_specific' && filePath && filePath.includes('fail_me')) {
    console.error('500 Internal Server Error: Upload rejected by backend');
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, source_id: 'mock-src-123' }));
  process.exit(0);
}

if (args[0] === 'source' && args[1] === 'list') {
  console.log(JSON.stringify([
    { id: 'mock-src-123', title: 'test_file_1.txt' }
  ]));
  process.exit(0);
}

process.exit(0);
`, 'utf8');

function setupTestDir(prefix) {
  const dir = path.join(REPO_ROOT, '.tmp_test_staging', `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupTestDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

test('ingest-nlm-runner: exits code 2 on auth check failure', (t) => {
  const testDir = setupTestDir('auth_fail');
  try {
    const res = spawnSync('node', [RUNNER_SCRIPT, 'test-uuid-auth', '--staging-dir', testDir], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)};${process.env.PATH}`,
        NLM_CLI: `node "${MOCK_CLI}"`,
        TEST_MOCK_MODE: 'auth_fail'
      }
    });

    assert.equal(res.status, 2, `Expected exit code 2 on auth failure, got ${res.status}`);
    const report = JSON.parse(res.stdout);
    assert.equal(report.ok, false);
    assert.match(report.error, /AUTH_INVALID_RELOGIN_REQUIRED/);
  } finally {
    cleanupTestDir(testDir);
  }
});

test('ingest-nlm-runner: payload budget rejects oversized file (> 380 KiB) to dead-letter', (t) => {
  const testDir = setupTestDir('oversized');
  try {
    // Write 400 KiB file
    const oversizedFile = path.join(testDir, 'oversized.txt');
    fs.writeFileSync(oversizedFile, 'X'.repeat(400 * 1024), 'utf8');

    const res = spawnSync('node', [RUNNER_SCRIPT, 'test-uuid-budget', '--staging-dir', testDir], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)};${process.env.PATH}`,
        NLM_CLI: `node "${MOCK_CLI}"`,
        TEST_MOCK_MODE: 'success'
      }
    });

    assert.equal(res.status, 1, `Expected partial failure exit 1, got ${res.status}`);
    
    // Check dead letter directory
    const deadLetterPath = path.join(testDir, '.dead-letter', 'oversized.txt');
    const deadLetterMeta = path.join(testDir, '.dead-letter', 'oversized.txt.error.json');
    assert.ok(fs.existsSync(deadLetterPath), 'Oversized file should be moved to dead-letter');
    assert.ok(fs.existsSync(deadLetterMeta), 'Dead-letter error metadata must exist');

    const meta = JSON.parse(fs.readFileSync(deadLetterMeta, 'utf8'));
    assert.match(meta.reason, /PAYLOAD_EXCEEDS_BUDGET/);
  } finally {
    cleanupTestDir(testDir);
  }
});

test('ingest-nlm-runner: idempotent skip via receipts', (t) => {
  const testDir = setupTestDir('idempotent');
  try {
    const file1 = path.join(testDir, 'test_file_1.txt');
    fs.writeFileSync(file1, 'hello world content', 'utf8');

    // Run 1: initial ingest
    const res1 = spawnSync('node', [RUNNER_SCRIPT, 'test-uuid-idempotent', '--staging-dir', testDir], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)};${process.env.PATH}`,
        NLM_CLI: `node "${MOCK_CLI}"`,
        TEST_MOCK_MODE: 'success'
      }
    });
    assert.equal(res1.status, 0, `Run 1 should succeed, stderr: ${res1.stderr}`);

    // Receipt file should exist
    const receiptPath = path.join(testDir, '.nlm-sync-receipt.json');
    assert.ok(fs.existsSync(receiptPath), 'Receipt file must exist');

    // Run 2: second ingest should skip
    const res2 = spawnSync('node', [RUNNER_SCRIPT, 'test-uuid-idempotent', '--staging-dir', testDir], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)};${process.env.PATH}`,
        NLM_CLI: `node "${MOCK_CLI}"`,
        TEST_MOCK_MODE: 'success'
      }
    });
    assert.equal(res2.status, 0);
    const report2 = JSON.parse(res2.stdout);
    assert.equal(report2.ingested, 0, 'No files should be ingested on second run');
    assert.equal(report2.skippedAlreadySynced, 1, 'File should be skipped as already synced');
  } finally {
    cleanupTestDir(testDir);
  }
});

test('ingest-nlm-runner: isolates single item failure and continues batch', (t) => {
  const testDir = setupTestDir('partial_failure');
  try {
    const fileGood = path.join(testDir, 'good_file.txt');
    const fileFail = path.join(testDir, 'fail_me.txt');
    fs.writeFileSync(fileGood, 'good content', 'utf8');
    fs.writeFileSync(fileFail, 'failing content', 'utf8');

    const res = spawnSync('node', [RUNNER_SCRIPT, 'test-uuid-partial', '--staging-dir', testDir, '--batch-size', '1'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)};${process.env.PATH}`,
        NLM_CLI: `node "${MOCK_CLI}"`,
        TEST_MOCK_MODE: 'fail_specific'
      }
    });

    assert.equal(res.status, 1, 'Run should return exit code 1 for partial failure');
    const report = JSON.parse(res.stdout);
    assert.equal(report.ingested, 1, 'Good file should have been ingested');
    assert.equal(report.failed.length, 1, 'Bad file should have failed');
    assert.equal(report.failed[0].fileName, 'fail_me.txt');

    // Dead-letter should contain only fail_me.txt
    const deadLetterFile = path.join(testDir, '.dead-letter', 'fail_me.txt');
    assert.ok(fs.existsSync(deadLetterFile), 'Failing file must be quarantined in dead-letter');
  } finally {
    cleanupTestDir(testDir);
  }
});

test('ingest-nlm-runner: rejects concurrent run when lock is held by live PID', (t) => {
  const testDir = setupTestDir('lock_contention');
  try {
    const lockPath = path.join(testDir, '.nlm-sync.lock');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), 'utf8');

    const res = spawnSync('node', [RUNNER_SCRIPT, 'test-uuid-lock', '--staging-dir', testDir], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)};${process.env.PATH}`,
        NLM_CLI: `node "${MOCK_CLI}"`,
        TEST_MOCK_MODE: 'success'
      }
    });

    assert.equal(res.status, 3, `Expected exit code 3 on active lock contention, got ${res.status}`);
    const report = JSON.parse(res.stderr || res.stdout);
    assert.equal(report.ok, false);
    assert.match(report.error, /CONCURRENT_RUN_IN_PROGRESS/);
  } finally {
    cleanupTestDir(testDir);
  }
});

test.after(() => {
  try {
    fs.unlinkSync(MOCK_CLI);
    fs.rmSync(path.join(REPO_ROOT, '.tmp_test_staging'), { recursive: true, force: true });
  } catch {}
});
