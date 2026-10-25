import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  calculateContentEntropy,
  calculateBatteryEntropy,
  resolveNotebookMetadata,
  generateDomainFallbackBattery,
  generateDynamicQuestionBattery,
  queryRecentlyModifiedEntities,
  loadOpenGapsForNotebook,
} from '../scripts/mining/dynamic-question-battery.mjs';

test('calculateContentEntropy computes non-zero entropy for rich text', () => {
  const e1 = calculateContentEntropy('hello world this is a test of shannon entropy');
  assert.ok(e1 > 3.0, `Expected entropy > 3.0, got ${e1}`);
  assert.equal(calculateContentEntropy(''), 0);
  assert.equal(calculateContentEntropy(null), 0);
});

test('resolveNotebookMetadata resolves by key and alias from categories.json', () => {
  const metaKey = resolveNotebookMetadata('ford-politics');
  assert.equal(metaKey.key, 'ford-politics');
  assert.match(metaKey.uuid, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);

  const metaAlias = resolveNotebookMetadata('aviation');
  assert.equal(metaAlias.key, 'willow-run');
  assert.match(metaAlias.uuid, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
});

test('generateDomainFallbackBattery generates questions with entropy >= 3.0', () => {
  const meta = resolveNotebookMetadata('ford-politics');
  const questions = generateDomainFallbackBattery(meta);
  assert.equal(questions.length, 4);
  const entropy = calculateBatteryEntropy(questions);
  assert.ok(entropy >= 3.0, `Expected entropy >= 3.0, got ${entropy}`);
});

test('generateDynamicQuestionBattery falls back to domain battery when AST entities < 2', () => {
  const result = generateDynamicQuestionBattery('ford-politics', {
    dbPath: 'non-existent-db-path.db', // forces 0 entities
  });

  assert.equal(result.source, 'domain_fallback');
  assert.equal(result.circuitBreakerSafe, true);
  assert.ok(result.entropy >= 3.0, `Battery entropy must be >= 3.0 to protect circuit breaker`);
  assert.ok(result.questions.length >= 4);
});

test('queryRecentlyModifiedEntities selects active entity pages and honors aliases', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-battery-'));
  const dbPath = path.join(tempDir, 'knowledge.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE kb_documents (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      topic TEXT NOT NULL,
      file_path TEXT NOT NULL,
      abstract TEXT,
      content TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      last_updated TEXT NOT NULL
    )
  `);
  const insert = db.prepare(`
    INSERT INTO kb_documents
      (id, category, topic, file_path, abstract, content, sha256, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run('active-aviation', 'research', 'b24-tooling', 'wiki/entities/kb-sync--aviation.md', 'aviation entity', '---\nstatus: active\n---\naviation', 'a', '2026-10-25T02:00:00Z');
  insert.run('active-b24', 'research', 'b24-wing', 'wiki/entities/kb-sync--b24.md', 'b24 entity', '---\nstatus: active\n---\nb24', 'b', '2026-10-25T01:00:00Z');
  insert.run('inactive-aviation', 'research', 'old-aviation', 'wiki/entities/kb-sync--old-aviation.md', 'inactive entity', '---\nstatus: draft\n---\naviation', 'c', '2026-10-25T03:00:00Z');
  insert.run('plain-aviation', 'research', 'plain-aviation', 'wiki/research/plain-aviation.md', 'plain document', '---\nstatus: active\n---\naviation', 'd', '2026-10-25T04:00:00Z');
  db.close();

  const results = queryRecentlyModifiedEntities(
    resolveNotebookMetadata('willow-run'),
    dbPath,
    3,
  );

  assert.deepEqual(results.map((row) => row.id), ['active-aviation', 'active-b24']);
});

test('open-gap loading accepts pending and in-progress gaps for aliases', () => {
  const gapsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-gaps-')), 'gaps.md');
  fs.writeFileSync(gapsPath, [
    '- [/] **aviation**: verify the primary engineering record',
    '- [ ] **willow-run**: reconcile the production timeline',
    '- [x] **aviation**: already resolved',
  ].join('\n'));

  const gaps = loadOpenGapsForNotebook(resolveNotebookMetadata('willow-run'), gapsPath, 3);

  assert.deepEqual(gaps.map((gap) => gap.title), ['aviation', 'willow-run']);
});

test('generateDynamicQuestionBattery gracefully handles completely missing categories and gaps files', () => {
  const result = generateDynamicQuestionBattery('ford-politics', {
    dbPath: 'non-existent-db.db',
    categoriesPath: 'non-existent-categories.json',
    gapsPath: 'non-existent-gaps.md',
  });

  assert.equal(result.source, 'domain_fallback');
  assert.equal(result.circuitBreakerSafe, true);
  assert.equal(result.gapCount, 0);
  assert.ok(result.entropy >= 3.0);
  assert.ok(result.questions.length >= 4);
});

