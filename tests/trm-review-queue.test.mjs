import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listCandidateEvidence, promoteCandidateEvidence } from '../scripts/trm-review-queue.mjs';

test('listCandidateEvidence returns pending candidate blocks', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-queue-test-'));
  const rfcFile = path.join(tmpDir, 'rfc-gap-00-fixture.md');
  fs.writeFileSync(rfcFile, '# RFC\n<!-- finding_id: 123456 -->\n- **Verification Status**: `inferred`\n');

  const list = listCandidateEvidence(tmpDir);
  assert.equal(list.length, 1);
  assert.equal(list[0].finding_id, '123456');
  assert.equal(list[0].status, 'inferred');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('promoteCandidateEvidence upgrades finding to verified while leaving gap status untouched', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-promote-test-'));
  const rfcFile = path.join(tmpDir, 'rfc-gap-00-fixture.md');
  fs.writeFileSync(rfcFile, '# RFC\n<!-- finding_id: 123456 -->\n- **Verification Status**: `inferred`\n');

  promoteCandidateEvidence({ rfcDir: tmpDir, gapId: 'GAP-00-FIXTURE', findingId: '123456' });
  const updated = fs.readFileSync(rfcFile, 'utf8');
  assert.ok(updated.includes('**Verification Status**: `verified`'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
