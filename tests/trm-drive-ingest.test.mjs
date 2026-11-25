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

test('ingestDriveFindings handles inaccessible Google Drive root without EPERM mkdir failure', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-gdrive-guard-test-'));
  const oneDriveInbox = path.join(tmpDir, 'onedrive-inbox');
  const oneDriveArchive = path.join(tmpDir, 'onedrive-archive');
  const targetDir = path.join(tmpDir, 'wiki', 'concepts', '2026-11-25');
  const logFile = path.join(tmpDir, 'Log.md');
  fs.mkdirSync(oneDriveInbox, { recursive: true });
  fs.writeFileSync(logFile, '# Log\n');

  const dropContent = `---
source: copilot
skill: drive-it
topic: kb
title: Guarded Drive Test
created: 2026-11-25T00:00:00Z
folder_id: onedrive-copilot
status: drop
---

# Guarded Drive Test
Verified local inbox ingestion when Google Drive mount is unavailable.
`;
  fs.writeFileSync(path.join(oneDriveInbox, '2026-11-25T000000Z__kb__guarded-drive-test.md'), dropContent);

  const res = await ingestDriveFindings({
    driveRoot: 'G:/My Drive/TRM-Research',
    completedDir: path.join(tmpDir, 'nonexistent-completed'),
    archiveCompletedDir: 'G:/My Drive/TRM-Research/04_archive/completed',
    archiveMobileInboxDir: 'G:/My Drive/TRM-Research/04_archive/mobile-inbox',
    archiveRejectedDir: 'G:/My Drive/TRM-Research/04_archive/rejected',
    locksDir: 'G:/My Drive/TRM-Research/_locks',
    inboxSources: [
      { inboxDir: oneDriveInbox, archiveDir: oneDriveArchive, name: 'onedrive-copilot-inbox' }
    ],
    topicTargets: { kb: targetDir },
    logPath: logFile,
    debounceMs: 10,
    commit: false
  });

  assert.equal(res.mobileIngestedCount, 1);
  assert.ok(fs.existsSync(path.join(targetDir, 'guarded-drive-test.md')));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
