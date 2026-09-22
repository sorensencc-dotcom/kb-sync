import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ingestDriveFindings } from '../scripts/trm-ingest-drive.mjs';

test('ingestDriveFindings skips duplicate finding_id idempotently', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-dedup-test-'));
  const driveRoot = path.join(tmpDir, 'TRM-Research');
  const completedDir = path.join(driveRoot, '03_grok_completed');
  fs.mkdirSync(completedDir, { recursive: true });

  const findingContent = `---\ngap_id: "GAP-00-FIXTURE"\nagent_origin: "copilot"\nverdict: "CONFIRMED"\nready: true\n---\n# Findings\nIdentical payload text`;
  const file1 = path.join(completedDir, 'GAP-00-FIXTURE-findings.md');
  fs.writeFileSync(file1, findingContent);

  const rfcFile = path.join(tmpDir, 'rfc-gap-00-fixture.md');
  fs.writeFileSync(rfcFile, '# RFC\n');
  const gapsRegistry = path.join(tmpDir, 'trm-research-gaps.md');
  fs.writeFileSync(gapsRegistry, '| GAP-00-FIXTURE | topic | HIGH | active |\n');
  const logFile = path.join(tmpDir, 'Log.md');
  fs.writeFileSync(logFile, '# Log\n');

  // Ingest 1
  await ingestDriveFindings({ driveRoot, rfcDir: tmpDir, registryPath: gapsRegistry, logPath: logFile, debounceMs: 10 });
  const countAfter1 = (fs.readFileSync(rfcFile, 'utf8').match(/finding_id:/g) || []).length;
  assert.equal(countAfter1, 1);

  // Ingest 2 with same content
  fs.writeFileSync(file1, findingContent);
  await ingestDriveFindings({ driveRoot, rfcDir: tmpDir, registryPath: gapsRegistry, logPath: logFile, debounceMs: 10 });
  const countAfter2 = (fs.readFileSync(rfcFile, 'utf8').match(/finding_id:/g) || []).length;
  assert.equal(countAfter2, 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
