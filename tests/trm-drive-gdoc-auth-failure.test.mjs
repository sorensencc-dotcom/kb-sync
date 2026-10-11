import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ingestDriveFindings } from '../scripts/trm-ingest-drive.mjs';

test('gdoc stub without oauth quarantines to rejected and exits 0', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-gdoc-test-'));
  const driveRoot = path.join(tmpDir, 'TRM-Research');
  const completedDir = path.join(driveRoot, '03_grok_completed');
  fs.mkdirSync(completedDir, { recursive: true });

  const stubFile = path.join(completedDir, 'GAP-00 READY.gdoc');
  fs.writeFileSync(stubFile, '{"doc_id": "fake_id"}');

  const res = await ingestDriveFindings({ driveRoot, debounceMs: 10, commit: false });
  assert.equal(res.ingestedCount, 0);
  assert.ok(!fs.existsSync(stubFile));
  assert.ok(fs.existsSync(path.join(driveRoot, '04_archive', 'rejected')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('mobile-inbox gdoc with 401 auth failure is quarantined to rejected directory', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-gdoc-mobile-fail-'));
  const driveRoot = path.join(tmpDir, 'TRM-Research');
  const mobileInboxDir = path.join(driveRoot, 'mobile-inbox');
  const archiveRejectedDir = path.join(driveRoot, '04_archive', 'rejected');
  fs.mkdirSync(mobileInboxDir, { recursive: true });
  fs.mkdirSync(archiveRejectedDir, { recursive: true });

  const gdocPath = path.join(mobileInboxDir, '2026-10-10T120000Z__action__kb-sync__act-test-fail.md.gdoc');
  fs.writeFileSync(gdocPath, JSON.stringify({ doc_id: 'doc_auth_error_123' }));

  const docFetcher = async () => ({ ok: false, error: '401 Unauthorized' });

  const res = await ingestDriveFindings({
    driveRoot,
    mobileInboxDir,
    archiveRejectedDir,
    debounceMs: 10,
    commit: false,
    docFetcher
  });

  assert.equal(res.mobileIngestedCount, 0);
  assert.ok(!fs.existsSync(gdocPath));
  const rejectedFiles = fs.readdirSync(archiveRejectedDir);
  assert.equal(rejectedFiles.length, 1);
  assert.ok(rejectedFiles[0].includes('act-test-fail'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('mobile-inbox gdoc with corrupt non-JSON content is safely quarantined to rejected', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-gdoc-corrupt-'));
  const driveRoot = path.join(tmpDir, 'TRM-Research');
  const mobileInboxDir = path.join(driveRoot, 'mobile-inbox');
  const archiveRejectedDir = path.join(driveRoot, '04_archive', 'rejected');
  fs.mkdirSync(mobileInboxDir, { recursive: true });

  const corruptGdoc = path.join(mobileInboxDir, 'corrupt-stub.gdoc');
  fs.writeFileSync(corruptGdoc, 'not-json-content-here');

  const res = await ingestDriveFindings({
    driveRoot,
    mobileInboxDir,
    archiveRejectedDir,
    debounceMs: 10,
    commit: false
  });

  assert.equal(res.mobileIngestedCount, 0);
  assert.ok(!fs.existsSync(corruptGdoc));
  const rejectedFiles = fs.readdirSync(archiveRejectedDir);
  assert.ok(rejectedFiles.some(f => f.startsWith('corrupt-stub.gdoc')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

