import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { batchDebounceFiles } from '../scripts/trm-ingest-drive.mjs';

test('batchDebounceFiles samples all candidates with single wait interval', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-debounce-test-'));
  const file1 = path.join(tmpDir, 'test1.md');
  const file2 = path.join(tmpDir, 'test2.md');
  fs.writeFileSync(file1, 'hello');
  fs.writeFileSync(file2, 'world');

  const stable = await batchDebounceFiles([file1, file2], 20);
  assert.equal(stable.length, 2);
  assert.ok(stable.includes(file1));
  assert.ok(stable.includes(file2));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
