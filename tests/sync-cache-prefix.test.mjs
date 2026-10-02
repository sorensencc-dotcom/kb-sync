// kb-sync/tests/sync-cache-prefix.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDatabase } from '../modules/cache/db-schema.mjs';
import { syncKnowledgeCache } from '../modules/cache/sync-cache.mjs';

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

const ids = (dbPath) => getDatabase(dbPath).prepare('SELECT id FROM kb_documents ORDER BY id').all().map((r) => r.id);

test('prefixed runs keep products apart and delete only their own stale rows', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'db-')), 'k.db');
  const a = tree({ 'Home.md': '# A', 'Old.md': '# old' });
  const b = tree({ 'Home.md': '# B' });
  syncKnowledgeCache({ repoRoot: a, scanPaths: ['.'], dbPath, idPrefix: 'product:a/' });
  syncKnowledgeCache({ repoRoot: b, scanPaths: ['.'], dbPath, idPrefix: 'product:b/' });
  assert.deepEqual(ids(dbPath), ['product:a/Home.md', 'product:a/Old.md', 'product:b/Home.md']);

  fs.rmSync(path.join(a, 'Old.md'));
  const stats = syncKnowledgeCache({ repoRoot: a, scanPaths: ['.'], dbPath, idPrefix: 'product:a/' });
  assert.equal(stats.deleted, 1);
  assert.deepEqual(ids(dbPath), ['product:a/Home.md', 'product:b/Home.md']);
});

test('a default run never deletes product rows', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'db-')), 'k.db');
  const prod = tree({ 'Home.md': '# P' });
  syncKnowledgeCache({ repoRoot: prod, scanPaths: ['.'], dbPath, idPrefix: 'product:p/' });
  const kb = tree({ 'wiki/research/note.md': '# n' });
  syncKnowledgeCache({ repoRoot: kb, dbPath });
  assert.deepEqual(ids(dbPath), ['product:p/Home.md', 'wiki/research/note.md']);
});
