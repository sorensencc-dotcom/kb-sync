import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDatabase } from '../modules/cache/db-schema.mjs';
import { generateWikiIndex } from '../scripts/generate-wiki-index.mjs';

function setup(docs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-index-'));
  const dbPath = path.join(dir, 'kb.db');
  const db = getDatabase(dbPath);
  const insert = db.prepare('INSERT INTO kb_documents (id, category, topic, file_path, abstract, content, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [file, category, abstract, content] of docs) insert.run(file, category, 't', file, abstract, content, 'x');
  db.close();
  return { dbPath, wikiDir: path.join(dir, 'wiki') };
}

test('groups by category with abstract or first-line summary', () => {
  const o = setup([
    ['wiki/research/b.md', 'research', 'B abstract', '# B'],
    ['wiki/concepts/a.md', 'concepts', null, '---\ntitle: a\n---\n# A\n\nFirst   real line.'],
    ['wiki/Log.md', 'source', null, 'log'],
    ['docs/x.md', 'source', null, 'not wiki'],
  ]);
  const r = generateWikiIndex(o);
  const index = fs.readFileSync(path.join(o.wikiDir, 'Index.md'), 'utf8');
  assert.equal(r.pages, 2);
  assert.ok(index.indexOf('## concepts') < index.indexOf('## research'));
  assert.match(index, /- \[\[concepts\/a\]\] — First real line\./);
  assert.match(index, /- \[\[research\/b\]\] — B abstract/);
  assert.doesNotMatch(index, /Log|docs\/x/);
});

test('splits into sub-indexes over maxLines and removes stale ones', () => {
  const docs = Array.from({ length: 6 }, (_, i) => [`wiki/r/p${i}.md`, i % 2 ? 'Research Notes' : 'gap', `s${i}`, '']);
  const o = setup(docs);
  fs.mkdirSync(o.wikiDir, { recursive: true });
  fs.writeFileSync(path.join(o.wikiDir, 'index-old.md'), 'stale');
  const r = generateWikiIndex({ ...o, maxLines: 8 });
  assert.deepEqual(r.files, ['Index.md', 'index-gap.md', 'index-research-notes.md']);
  assert.ok(!fs.existsSync(path.join(o.wikiDir, 'index-old.md')));
  const index = fs.readFileSync(path.join(o.wikiDir, 'Index.md'), 'utf8');
  assert.match(index, /\[\[index-research-notes\]\] — Research Notes \(3 pages\)/);
  generateWikiIndex({ ...o, maxLines: 500 });
  assert.ok(!fs.existsSync(path.join(o.wikiDir, 'index-gap.md')));
});
