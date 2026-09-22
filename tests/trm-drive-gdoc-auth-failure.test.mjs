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
