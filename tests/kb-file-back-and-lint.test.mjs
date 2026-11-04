import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileAnswer, buildNote } from '../scripts/kb-file-answer.mjs';
import { lintContent } from '../scripts/kb-content-lint.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('file-back writes a dated, cited, verified note under docs/kb/agent-answers', () => {
  const root = tmp('fileback-');
  const now = new Date('2026-11-03T12:00:00Z');
  const f = fileAnswer({ title: 'How does the cache sync?', body: 'It walks docs/kb.', cites: ['scripts/sync-kb-cache.mjs'], repoRoot: root, now });
  assert.equal(path.relative(root, f).split(path.sep).join('/'), 'docs/kb/agent-answers/2026-11-03/how-does-the-cache-sync.md');
  const text = fs.readFileSync(f, 'utf8');
  assert.match(text, /^---\ntitle: "How does the cache sync\?"\nsource: agent-answer\nverified: true\n/);
  assert.match(text, /cites:\n {2}- "scripts\/sync-kb-cache.mjs"/);
  const f2 = fileAnswer({ title: 'How does the cache sync?', body: 'again', cites: ['x'], repoRoot: root, now });
  assert.ok(f2.endsWith('how-does-the-cache-sync-2.md'));
});

test('file-back rejects notes with no citations', () => {
  assert.throws(() => buildNote({ title: 't', body: 'b', cites: [] }), /citation/);
  assert.throws(() => buildNote({ title: 't', body: 'b', cites: ['  '] }), /citation/);
});

test('content lint finds orphans, dead wikilinks and stale pages', () => {
  const w = tmp('lint-');
  const write = (p, s) => { fs.mkdirSync(path.dirname(path.join(w, p)), { recursive: true }); fs.writeFileSync(path.join(w, p), s); };
  write('Index.md', '[[concepts/a|A]] [[kb-sync/concepts/b]] [[missing-page]]');
  write('concepts/a.md', '---\nupdated: 2026-11-01\n---\n[[b.md#x]]');
  write('concepts/b.md', '---\nupdated: 2025-01-01\n---\nno links');
  write('concepts/lonely.md', '---\nupdated: 2026-11-01\n---\n[[nope/also-missing]]');
  const r = lintContent({ wikiDir: w, maxAgeDays: 90, now: Date.parse('2026-11-03'), gitTimes: new Map() });
  assert.deepEqual(r.counts, { pages: 4, orphans: 1, dead_links: 2, stale: 1 });
  assert.deepEqual(r.orphans, ['concepts/lonely.md']);
  assert.equal(r.stale_pages[0].page, 'concepts/b.md');
  assert.equal(r.top_offenders.dead_links_by_page.length, 2);
});

test('content lint counts dot-named pages and resolves full-suffix links to them', () => {
  const w = tmp('lint-dot-');
  fs.mkdirSync(path.join(w, 'entities'));
  fs.writeFileSync(path.join(w, 'Index.md'), '[[entities/.state.json.md]] [[entities/lesson.md.md]]');
  fs.writeFileSync(path.join(w, 'entities', '.state.json.md'), 'x');
  fs.writeFileSync(path.join(w, 'entities', 'lesson.md.md'), 'x');
  const r = lintContent({ wikiDir: w, now: Date.parse('2026-11-03'), gitTimes: new Map() });
  assert.deepEqual(r.counts, { pages: 3, orphans: 0, dead_links: 0, stale: 0 });
});
