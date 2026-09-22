import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ingestDriveFindings } from '../scripts/trm-ingest-drive.mjs';

test('ingestDriveFindings appends candidate evidence and archives without default git commit', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-ingest-test-'));
  const driveRoot = path.join(tmpDir, 'TRM-Research');
  const completedDir = path.join(driveRoot, '03_grok_completed');
  const gapsOutDir = path.join(driveRoot, '01_actionable_gaps');
  fs.mkdirSync(completedDir, { recursive: true });
  fs.mkdirSync(gapsOutDir, { recursive: true });

  const findingFile = path.join(completedDir, 'GAP-00-FIXTURE-findings.md');
  fs.writeFileSync(findingFile, `---\ngap_id: "GAP-00-FIXTURE"\nagent_origin: "copilot"\nverdict: "CONFIRMED"\nready: true\n---\n# Findings\nEvidence text [1]`);

  fs.writeFileSync(path.join(gapsOutDir, 'GAP-00-FIXTURE.md'), 'card');

  const rfcFile = path.join(tmpDir, 'rfc-gap-00-fixture.md');
  fs.writeFileSync(rfcFile, '# RFC: GAP-00-FIXTURE\n\n## Summary\nInitial RFC.\n');

  const gapsRegistry = path.join(tmpDir, 'trm-research-gaps.md');
  fs.writeFileSync(gapsRegistry, '| GAP-00-FIXTURE | topic | HIGH | active |\n');

  const logFile = path.join(tmpDir, 'Log.md');
  fs.writeFileSync(logFile, '# Log\n');

  const res = await ingestDriveFindings({
    driveRoot,
    rfcDir: tmpDir,
    registryPath: gapsRegistry,
    logPath: logFile,
    debounceMs: 10,
    commit: false
  });

  assert.equal(res.ingestedCount, 1);
  const rfcContent = fs.readFileSync(rfcFile, 'utf8');
  assert.ok(rfcContent.includes('Candidate Evidence: Remote Agent Finding'));
  assert.ok(rfcContent.includes('<!-- finding_id:'));
  assert.ok(!fs.existsSync(findingFile)); // Moved to archive
  assert.ok(fs.existsSync(path.join(driveRoot, '04_archive', 'completed')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
