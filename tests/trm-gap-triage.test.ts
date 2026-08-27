import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getDatabase } from '../modules/cache/db-schema.mjs';
import { parseGapItems, triageGapAgainstCache, executeGapTriage } from '../modules/trm/gap-triage-engine.mjs';

describe('TRM Automated Gap Triage & RFC Synthesis Suite', () => {
  let sandboxRoot: string;
  let testDbPath: string;
  let gapsFilePath: string;
  let outputDir: string;

  beforeEach(() => {
    sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-triage-test-'));
    testDbPath = path.join(sandboxRoot, '.kb_cache', 'knowledge.db');
    gapsFilePath = path.join(sandboxRoot, 'trm-research-gaps.md');
    outputDir = path.join(sandboxRoot, 'wiki', 'research');

    fs.mkdirSync(path.dirname(testDbPath), { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  });

  test('TEST-01: Markdown gap list parser extracts structured items and statuses', () => {
    const markdown = `# Gaps
- [ ] [GAP-01] Fail-soft recovery: SQLite state verification under load.
- [/] [GAP-02] Path normalization: Traversal defense across OS platforms.
- [x] [GAP-03] Completed task: Already resolved.
- [ ] Unlabeled gap item without explicit ID.
`;

    const parsed = parseGapItems(markdown);
    assert.equal(parsed.length, 4);

    assert.equal(parsed[0].id, 'GAP-01');
    assert.equal(parsed[0].status, 'pending');
    assert.equal(parsed[0].title, 'Fail-soft recovery');
    assert.equal(parsed[0].description, 'SQLite state verification under load.');

    assert.equal(parsed[1].id, 'GAP-02');
    assert.equal(parsed[1].status, 'in-progress');

    assert.equal(parsed[2].id, 'GAP-03');
    assert.equal(parsed[2].status, 'resolved');

    assert.equal(parsed[3].id, 'GAP-04');
    assert.equal(parsed[3].status, 'pending');
  });

  test('TEST-02: Gap triage queries SQLite cache and synthesizes RFC with citations', async () => {
    const db = getDatabase(testDbPath);

    // Seed SQLite knowledge database with related documentation
    db.prepare(`
      INSERT INTO kb_documents (id, category, topic, file_path, content, sha256)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'wiki/concepts/fail-soft-orchestration.md',
      'research',
      'fail-soft-orchestration',
      'wiki/concepts/fail-soft-orchestration.md',
      'Fail-soft orchestration ensures SQLite write locks recover safely on interrupted operations.',
      'hash_fs'
    );

    const gap = {
      id: 'GAP-01',
      title: 'Fail-soft orchestration',
      description: 'Need clarity on SQLite write locks during crash.',
      status: 'pending',
      line: '- [ ] [GAP-01] Fail-soft orchestration: Need clarity on SQLite write locks during crash.',
      raw: '- [ ] [GAP-01] Fail-soft orchestration: Need clarity on SQLite write locks during crash.'
    };

    const triage = await triageGapAgainstCache(db, gap);

    assert.ok(triage.topicSlug.startsWith('rfc-gap-01-fail-soft-orchestration'));
    assert.equal(triage.matchedDocuments.length, 1);
    assert.equal(triage.matchedDocuments[0].topic, 'fail-soft-orchestration');
    assert.ok(triage.rfcContent.includes('---'));
    assert.ok(triage.rfcContent.includes('title: "RFC: GAP-01 - Fail-soft orchestration"'));
    assert.ok(triage.rfcContent.includes('Evidence Grounding & Cache Findings'));
    assert.ok(triage.citations.includes('wiki/concepts/fail-soft-orchestration.md'));

    db.close();
  });

  test('TEST-03: End-to-end executeGapTriage writes RFC files and updates tracking file', async () => {
    const db = getDatabase(testDbPath);
    db.prepare(`
      INSERT INTO kb_documents (id, category, topic, file_path, content, sha256)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'wiki/concepts/path-normalization.md',
      'research',
      'path-normalization',
      'wiki/concepts/path-normalization.md',
      'Path normalization cleans trailing backslashes and converts paths to canonical forward slashes.',
      'hash_pn'
    );
    db.close();

    const initialGapsContent = `# Gaps Matrix
- [ ] [GAP-02] Path normalization: Cross-platform slash conversions.
- [x] [GAP-01] Resolved gap: Already done.
`;
    fs.writeFileSync(gapsFilePath, initialGapsContent, 'utf8');

    const result = await executeGapTriage({
      gapsFilePath,
      outputDir,
      dbPath: testDbPath
    });

    assert.equal(result.processed, 1);
    assert.equal(result.rfcFiles.length, 1);

    // Verify generated RFC file on disk
    const generatedRfcPath = path.join(outputDir, path.basename(result.rfcFiles[0]));
    assert.ok(fs.existsSync(generatedRfcPath), 'RFC file must be written to disk');
    const rfcContent = fs.readFileSync(generatedRfcPath, 'utf8');
    assert.ok(rfcContent.includes('Path normalization'));

    // Verify updated gaps tracking file
    const updatedGapsContent = fs.readFileSync(gapsFilePath, 'utf8');
    assert.ok(updatedGapsContent.includes('- [/] [GAP-02]'));
    assert.ok(updatedGapsContent.includes('(Drafted: [RFC]('));
    assert.ok(updatedGapsContent.includes('- [x] [GAP-01] Resolved gap: Already done.'));
  });
});
