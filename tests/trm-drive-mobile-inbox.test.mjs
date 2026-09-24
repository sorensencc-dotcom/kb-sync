import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ingestDriveFindings } from '../scripts/trm-ingest-drive.mjs';
import { validateMobileInboxDrop, sanitizeSlug } from '../scripts/validate-drive-findings.mjs';

test('validateMobileInboxDrop parses and validates valid Grok drive-it drops', () => {
  const raw = `---
source: grok
skill: drive-it
topic: cic
title: THF Sorensen Catalog Audit
created: 2026-09-23T02:26:18Z
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
---

# THF Sorensen Catalog Audit
Sample body text with citations [1].
`;
  const res = validateMobileInboxDrop(raw, '2026-09-23T022618Z__cic__thf-sorensen-catalog-audit.md');
  assert.equal(res.valid, true);
  assert.equal(res.date, '2026-09-23');
  assert.equal(res.slug, 'thf-sorensen-catalog-audit');
  assert.equal(res.frontmatter.source, 'grok');
  assert.equal(res.frontmatter.status, 'drop');
  assert.ok(res.body.includes('Sample body text'));
});

test('sanitizeSlug handles traversal, colons, Windows reserved names, and non-ASCII safely', () => {
  assert.equal(sanitizeSlug('Aux'), 'aux-item');
  assert.equal(sanitizeSlug('COM1'), 'com1-item');
  assert.equal(sanitizeSlug('../../../etc/passwd'), 'etc-passwd');
  assert.equal(sanitizeSlug('Topic: Sub-topic (Test/Item)'), 'topic-sub-topic-test-item');
  assert.equal(sanitizeSlug(''), 'untitled-drop');
});

test('validateMobileInboxDrop quarantines invalid YAML or missing status', () => {
  const badFm = `---
title: Missing Source
---
Body text`;
  const res = validateMobileInboxDrop(badFm, 'bad.md');
  assert.equal(res.valid, false);
  assert.ok(res.errors.length > 0);
});

test('ingestDriveFindings processes mobile-inbox drops into conversations and archives', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-mobile-inbox-test-'));
  const driveRoot = path.join(tmpDir, 'TRM-Research');
  const mobileInboxDir = path.join(driveRoot, 'mobile-inbox');
  const conversationsDir = path.join(tmpDir, 'conversations');
  const logFile = path.join(tmpDir, 'Log.md');
  fs.mkdirSync(mobileInboxDir, { recursive: true });
  fs.mkdirSync(conversationsDir, { recursive: true });
  fs.writeFileSync(logFile, '# Log\n');

  const dropContent = `---
source: grok
skill: drive-it
topic: cic
title: Cuban Seizures Source Audit
created: 2026-09-23T22:56:25Z
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
---

# Cuban Seizures Source Audit
Primary findings on FCSC decisions [1].
`;
  const dropFilename = '2026-09-23T225625Z__cic__cuban-seizures-source-audit.md';
  fs.writeFileSync(path.join(mobileInboxDir, dropFilename), dropContent);

  const res = await ingestDriveFindings({
    driveRoot,
    mobileInboxDir,
    conversationsDir,
    logPath: logFile,
    debounceMs: 10,
    commit: false
  });

  assert.equal(res.mobileIngestedCount, 1);
  assert.equal(res.total, 1);

  // Check target conversation
  const targetFile = path.join(conversationsDir, '2026-09-23', 'cuban-seizures-source-audit.md');
  assert.ok(fs.existsSync(targetFile));
  const writtenContent = fs.readFileSync(targetFile, 'utf8');
  assert.ok(writtenContent.includes('provenance_type: mobile_inbox_drop'));
  assert.ok(writtenContent.includes('Cuban Seizures Source Audit'));

  // Check source was archived
  assert.ok(!fs.existsSync(path.join(mobileInboxDir, dropFilename)));
  const archiveMobileDir = path.join(driveRoot, '04_archive', 'mobile-inbox');
  assert.ok(fs.existsSync(archiveMobileDir));
  const archivedFiles = fs.readdirSync(archiveMobileDir);
  assert.equal(archivedFiles.length, 1);
  assert.ok(archivedFiles[0].startsWith(dropFilename));

  // Check Log.md
  const logContent = fs.readFileSync(logFile, 'utf8');
  assert.ok(logContent.includes('Ingested mobile drop'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
