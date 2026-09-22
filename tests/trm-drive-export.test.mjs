import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exportGapsToDrive, redactContext } from '../scripts/trm-export-gaps.mjs';

test('redactContext strips sensitive data against deny-list', () => {
  const sensitive = "Contact cmsormi@example.com or call 555-0199. Notes in C:\\private\\kroll.log.";
  const clean = redactContext(sensitive);
  assert.ok(!clean.includes('cmsormi@example.com'));
  assert.ok(!clean.includes('555-0199'));
  assert.ok(!clean.includes('C:\\private'));
  assert.ok(clean.includes('[REDACTED]'));
});

test('exportGapsToDrive writes card and reference context pack in FIFO priority order', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-export-test-'));
  const gapsMd = path.join(tmpDir, 'trm-research-gaps.md');
  fs.writeFileSync(gapsMd, `# Research Gaps\n| Gap ID | Topic | Priority | Status |\n|---|---|---|---|\n| GAP-00-FIXTURE | test/topic | HIGH | active |\n`);

  const driveRoot = path.join(tmpDir, 'TRM-Research');
  const exported = await exportGapsToDrive({
    registryPath: gapsMd,
    driveRoot,
    priority: 'HIGH',
    limit: 5
  });

  assert.equal(exported.length, 1);
  assert.equal(exported[0].gap_id, 'GAP-00-FIXTURE');
  assert.ok(fs.existsSync(path.join(driveRoot, '01_actionable_gaps', 'GAP-00-FIXTURE.md')));
  assert.ok(fs.existsSync(path.join(driveRoot, '02_reference_context', 'GAP-00-FIXTURE-context-pack.md')));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
