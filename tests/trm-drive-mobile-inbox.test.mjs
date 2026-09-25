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

test('ingestDriveFindings routes multi-topic drops to designated target subdirectories', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-topic-routing-test-'));
  const driveRoot = path.join(tmpDir, 'TRM-Research');
  const mobileInboxDir = path.join(driveRoot, 'mobile-inbox');
  const logFile = path.join(tmpDir, 'Log.md');
  fs.mkdirSync(mobileInboxDir, { recursive: true });
  fs.writeFileSync(logFile, '# Log\n');

  const topics = [
    { topic: 'spec', slug: 'auth-contract' },
    { topic: 'rewrite', slug: 'pipeline-refactor' },
    { topic: 'trm', slug: 'gap-investigation' },
    { topic: 'kb', slug: 'architecture-pattern' },
    { topic: 'default', slug: 'unsorted-note' }
  ];

  for (const { topic, slug } of topics) {
    const content = `---
source: copilot
skill: drive-it
topic: ${topic}
title: ${slug}
created: 2026-09-25T12:00:00Z
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
---

# ${slug}
Content for ${topic}
`;
    fs.writeFileSync(path.join(mobileInboxDir, `2026-09-25T120000Z__${topic}__${slug}.md`), content);
  }

  const res = await ingestDriveFindings({
    driveRoot,
    mobileInboxDir,
    repoRoot: tmpDir,
    logPath: logFile,
    debounceMs: 10,
    commit: false,
    topicTargets: {
      spec: path.join(tmpDir, 'wiki', 'specs', '2026-09-25'),
      rewrite: path.join(tmpDir, 'wiki', 'rewrite', '2026-09-25'),
      trm: path.join(tmpDir, 'wiki', 'research', '2026-09-25'),
      kb: path.join(tmpDir, 'wiki', 'concepts', '2026-09-25'),
      default: path.join(tmpDir, 'wiki', 'inbox', '2026-09-25')
    }
  });

  assert.equal(res.mobileIngestedCount, 5);

  assert.ok(fs.existsSync(path.join(tmpDir, 'wiki', 'specs', '2026-09-25', 'auth-contract.md')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'wiki', 'rewrite', '2026-09-25', 'pipeline-refactor.md')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'wiki', 'research', '2026-09-25', 'gap-investigation.md')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'wiki', 'concepts', '2026-09-25', 'architecture-pattern.md')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'wiki', 'inbox', '2026-09-25', 'unsorted-note.md')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ingestDriveFindings sweeps both GDrive and OneDrive inboxes simultaneously', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-dual-inbox-test-'));
  const gdriveInbox = path.join(tmpDir, 'gdrive-inbox');
  const gdriveArchive = path.join(tmpDir, 'gdrive-archive');
  const onedriveInbox = path.join(tmpDir, 'onedrive-inbox');
  const onedriveArchive = path.join(tmpDir, 'onedrive-archive');
  const logFile = path.join(tmpDir, 'Log.md');

  fs.mkdirSync(gdriveInbox, { recursive: true });
  fs.mkdirSync(onedriveInbox, { recursive: true });
  fs.writeFileSync(logFile, '# Log\n');

  // GDrive drop
  const gdriveDrop = `---
source: grok
skill: drive-it
topic: spec
title: GDrive Spec Drop
created: 2026-09-25T14:00:00Z
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
---

# GDrive Spec Drop
`;
  fs.writeFileSync(path.join(gdriveInbox, '2026-09-25T140000Z__spec__gdrive-spec-drop.md'), gdriveDrop);

  // OneDrive drop
  const onedriveDrop = `---
source: copilot
skill: drive-it
topic: kb
title: OneDrive KB Drop
created: 2026-09-25T14:00:00Z
folder_id: onedrive-copilot
status: drop
---

# OneDrive KB Drop
`;
  fs.writeFileSync(path.join(onedriveInbox, '2026-09-25T140000Z__kb__onedrive-kb-drop.md'), onedriveDrop);

  const res = await ingestDriveFindings({
    driveRoot: tmpDir,
    logPath: logFile,
    debounceMs: 10,
    commit: false,
    inboxSources: [
      { inboxDir: gdriveInbox, archiveDir: gdriveArchive, name: 'gdrive-inbox' },
      { inboxDir: onedriveInbox, archiveDir: onedriveArchive, name: 'onedrive-inbox' }
    ],
    topicTargets: {
      spec: path.join(tmpDir, 'wiki', 'specs', '2026-09-25'),
      kb: path.join(tmpDir, 'wiki', 'concepts', '2026-09-25')
    }
  });

  assert.equal(res.mobileIngestedCount, 2);
  assert.ok(fs.existsSync(path.join(tmpDir, 'wiki', 'specs', '2026-09-25', 'gdrive-spec-drop.md')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'wiki', 'concepts', '2026-09-25', 'onedrive-kb-drop.md')));

  // Check both source folders are now empty
  assert.equal(fs.readdirSync(gdriveInbox).length, 0);
  assert.equal(fs.readdirSync(onedriveInbox).length, 0);

  // Check both archive folders have 1 file
  assert.equal(fs.readdirSync(gdriveArchive).length, 1);
  assert.equal(fs.readdirSync(onedriveArchive).length, 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});


